import 'dart:io';

import 'package:flutter/material.dart';
import 'package:camera/camera.dart';
import 'package:image_picker/image_picker.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest.dart' as tz;
import 'package:timezone/timezone.dart' as tz;

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Supabase.initialize(
    url: 'https://gmwurbvhhzgdikogxiqb.supabase.co',
    anonKey: 'sb_publishable_i7IHac8LyrXoG3aiLDlS7A_1Vua8h8l',
  );

  await NotificationService.initialize();

  runApp(const DUTCampusStreakApp());
}

final supabase = Supabase.instance.client;

final FlutterLocalNotificationsPlugin localNotifications =
    FlutterLocalNotificationsPlugin();

class NotificationService {
  static const String _channelId = 'class_reminders';
  static const String _channelName = 'Nhắc lịch học';
  static const String _channelDescription =
      'Nhắc trước 15 phút khi tiết học sắp bắt đầu.';

  static Future<void> initialize() async {
    tz.initializeTimeZones();
    tz.setLocalLocation(tz.getLocation('Asia/Ho_Chi_Minh'));

    const settings = InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
    );

    await localNotifications.initialize(
      settings: settings,
    );

    final android = localNotifications
        .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>();

    await android?.createNotificationChannel(
      const AndroidNotificationChannel(
        _channelId,
        _channelName,
        description: _channelDescription,
        importance: Importance.high,
      ),
    );

    await android?.requestNotificationsPermission();
  }

  static int _notificationId(String classId) {
    var hash = 0;
    for (final codeUnit in classId.codeUnits) {
      hash = (hash * 31 + codeUnit) & 0x7fffffff;
    }
    return hash;
  }

  static Future<void> syncSchedule(
    List<ClassSession> classes,
  ) async {
    await localNotifications.cancelAll();

    for (final classSession in classes) {
      // Inactive sessions are soft-deleted: keep their check-in history,
      // but never schedule reminders for them.
      if (!classSession.isActive) continue;

      final parts = classSession.startTime.split(':');

      if (classSession.id.isEmpty ||
          parts.length < 2 ||
          classSession.dayOfWeek < 1 ||
          classSession.dayOfWeek > 7) {
        continue;
      }

      final hour = int.tryParse(parts[0]);
      final minute = int.tryParse(parts[1]);
      if (hour == null || minute == null) continue;

      final now = tz.TZDateTime.now(tz.local);

      var scheduled = tz.TZDateTime(
        tz.local,
        now.year,
        now.month,
        now.day,
        hour,
        minute,
      ).subtract(const Duration(minutes: 15));

      final daysUntil =
          (classSession.dayOfWeek - now.weekday + 7) % 7;

      scheduled = scheduled.add(Duration(days: daysUntil));

      if (!scheduled.isAfter(now)) {
        scheduled = scheduled.add(const Duration(days: 7));
      }

      // Schedule the reminder as a real Android alarm. It is independent
    // of the Flutter UI, so it can fire while the user is on the Home
    // screen, inside another app, or with DUT Campus Streak closed.
    //
    // We intentionally use inexactAllowWhileIdle here so Android does not
    // require the special exact-alarm permission. The reminder is targeted
    // at 15 minutes before class and may be delivered with a small system
    // scheduling delay.
    await localNotifications.zonedSchedule(
      id: _notificationId(classSession.id),
      title: 'Sắp đến giờ học',
      body: 'Tiết học sẽ bắt đầu lúc ${_formatTimeHHmm(classSession.startTime)} '
          'tại phòng ${classSession.room}.',
      scheduledDate: scheduled,
      notificationDetails: const NotificationDetails(
        android: AndroidNotificationDetails(
          _channelId,
          _channelName,
          channelDescription: _channelDescription,
          importance: Importance.high,
          priority: Priority.high,
          playSound: true,
        ),
      ),
      androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
      matchDateTimeComponents: DateTimeComponents.dayOfWeekAndTime,
    );
    }
  }

  static Future<int> pendingCount() async {
    final pending = await localNotifications.pendingNotificationRequests();
    return pending.length;
  }
}


// ============================================================
// APP
// ============================================================

class DUTCampusStreakApp extends StatelessWidget {
  const DUTCampusStreakApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'DUT Campus Streak',
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF005BAC),
        ),
      ),
      home: const AuthGate(),
    );
  }
}

// ============================================================
// TIME DISPLAY
// ============================================================

String _formatTimeHHmm(String value) {
  final parts = value.split(':');
  final hour = int.tryParse(parts.isNotEmpty ? parts[0] : '') ?? 0;
  final minute = int.tryParse(parts.length > 1 ? parts[1] : '') ?? 0;
  return '${hour.toString().padLeft(2, '0')}:${minute.toString().padLeft(2, '0')}';
}

// ============================================================
// MODEL
// ============================================================

class ClassSession {
  final String id;
  final String subject;
  final String room;
  final String startTime;
  final String endTime;
  final String teacher;
  final int dayOfWeek;
  final bool isActive;

  // Tạm thời dùng cho UI.
  // Sau này sẽ lấy trạng thái từ check_ins.
  final bool completed;

  ClassSession({
    required this.id,
    required this.subject,
    required this.room,
    required this.startTime,
    required this.endTime,
    required this.teacher,
    required this.dayOfWeek,
    this.isActive = true,
    this.completed = false,
  });

  String get time => '${_formatTimeHHmm(startTime)} – ${_formatTimeHHmm(endTime)}';

  bool get isCheckInExcluded {
    final normalizedRoom = room.trim().toUpperCase();
    final normalizedSubject = subject.trim().toUpperCase();

    return normalizedRoom == 'MSTEAM' ||
        normalizedSubject.contains('GDTC');
  }

  ClassSession copyWith({
    bool? completed,
  }) {
    return ClassSession(
      id: id,
      subject: subject,
      room: room,
      startTime: startTime,
      endTime: endTime,
      teacher: teacher,
      dayOfWeek: dayOfWeek,
      isActive: isActive,
      completed: completed ?? this.completed,
    );
  }

  factory ClassSession.fromMap(Map<String, dynamic> map) {
    final rawSubject = map['subjects'];

    Map<String, dynamic>? subjectMap;

    if (rawSubject is Map) {
      subjectMap = Map<String, dynamic>.from(rawSubject);
    }

    return ClassSession(
      id: map['id']?.toString() ?? '',
      subject:
          subjectMap?['name']?.toString() ?? 'Không có tên môn',
      room: map['room']?.toString() ?? '',
      startTime: map['start_time']?.toString() ?? '',
      endTime: map['end_time']?.toString() ?? '',
      teacher:
          map['teacher']?.toString() ??
          subjectMap?['teacher']?.toString() ??
          '',
      dayOfWeek:
          (map['day_of_week'] as num?)?.toInt() ?? 0,
      isActive: map['is_active'] != false,
    );
  }
}

// ============================================================
// AUTH HELPERS
// ============================================================

Future<void> ensureCurrentUserData({String? displayName}) async {
  final user = supabase.auth.currentUser;
  if (user == null) return;

  final existingUser = await supabase
      .from('users')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

  final fallbackName =
      displayName?.trim().isNotEmpty == true
          ? displayName!.trim()
          : (user.userMetadata?['display_name']?.toString().trim().isNotEmpty == true
              ? user.userMetadata!['display_name'].toString().trim()
              : (user.email?.split('@').first ?? 'Sinh viên'));

  if (existingUser == null) {
    await supabase.from('users').insert({
      'id': user.id,
      'name': fallbackName,
      'email': user.email,
      'student_code': '',
      'class_name': '',
    });
  } else if (user.email != null) {
    // Đồng bộ email Auth sang public.users sau khi email mới đã được
    // Supabase xác nhận. Khi đang chờ xác nhận, user.email vẫn là email cũ.
    await supabase
        .from('users')
        .update({
          'email': user.email,
        })
        .eq('id', user.id);
  }

  final existingProfile = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

  if (existingProfile == null) {
    await supabase.from('profiles').insert({
      'id': user.id,
      'display_name': fallbackName,
    });
  }
}

// ============================================================
// AUTH GATE
// ============================================================

class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _restoreSession();
  }

  Future<void> _restoreSession() async {
    try {
      final user = supabase.auth.currentUser;

      if (user != null) {
        await ensureCurrentUserData();
      }

      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = null;
      });
    } catch (e) {
      debugPrint('Restore session error: $e');
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    if (_error != null) {
      return Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'Không thể khôi phục phiên đăng nhập.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 12),
                Text(_error!, textAlign: TextAlign.center),
                const SizedBox(height: 20),
                ElevatedButton(
                  onPressed: () {
                    setState(() {
                      _loading = true;
                      _error = null;
                    });
                    _restoreSession();
                  },
                  child: const Text('Thử lại'),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return supabase.auth.currentSession == null
        ? const LoginScreen()
        : const HomeScreen();
  }
}

// ============================================================
// LOGIN
// ============================================================

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final TextEditingController _emailController =
      TextEditingController();

  final TextEditingController _passwordController =
      TextEditingController();

  bool _isLoading = false;
  bool _obscurePassword = true;
  String? _errorMessage;

  Future<void> _login() async {
    final email = _emailController.text.trim();
    final password = _passwordController.text;

    if (email.isEmpty || password.isEmpty) {
      setState(() {
        _errorMessage =
            'Vui lòng nhập email và mật khẩu.';
      });
      return;
    }

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final response =
          await supabase.auth.signInWithPassword(
        email: email,
        password: password,
      );

      if (!mounted) return;

      if (response.user == null) {
        setState(() {
          _errorMessage =
              'Đăng nhập không thành công.';
          _isLoading = false;
        });
        return;
      }

      debugPrint(
        'Logged in user ID: ${response.user!.id}',
      );

      await ensureCurrentUserData();

      if (!mounted) return;

      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(builder: (_) => const HomeScreen()),
        (_) => false,
      );
    } on AuthException catch (e) {
      if (!mounted) return;

      setState(() {
        _errorMessage = e.message;
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;

      setState(() {
        _errorMessage =
            'Có lỗi xảy ra. Vui lòng thử lại.';
        _isLoading = false;
      });

      debugPrint('Login error: $e');
    }
  }


  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;

    return Scaffold(
      body: Container(
        width: double.infinity,
        height: double.infinity,
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              Color(0xFF075FD8),
              Color(0xFF083BC5),
              Color(0xFF071C8E),
            ],
          ),
        ),
        child: SafeArea(
          child: Stack(
            children: [
              // Decorative circles inspired by the supplied DUT reference.
              Positioned(
                top: -90,
                right: -70,
                child: Container(
                  width: 220,
                  height: 220,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: Colors.white.withOpacity(0.06),
                  ),
                ),
              ),
              Positioned(
                bottom: -80,
                left: -60,
                child: Container(
                  width: 220,
                  height: 220,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: Colors.white.withOpacity(0.05),
                  ),
                ),
              ),

              SingleChildScrollView(
                physics: const BouncingScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(24, 34, 24, 28),
                child: ConstrainedBox(
                  constraints: BoxConstraints(
                    minHeight: size.height - 70,
                  ),
                  child: Column(
                    children: [
                      const SizedBox(height: 12),

                      // App mark.
                      Container(
                        width: 104,
                        height: 104,
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: Colors.white.withOpacity(0.12),
                          borderRadius: BorderRadius.circular(30),
                          border: Border.all(
                            color: Colors.white.withOpacity(0.22),
                          ),
                        ),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(22),
                          child: Image.asset(
                            'assets/icon/dut_campus_streak.png',
                            fit: BoxFit.cover,
                          ),
                        ),
                      ),

                      const SizedBox(height: 24),

                      const Text(
                        'Welcome to',
                        style: TextStyle(
                          color: Colors.white70,
                          fontSize: 17,
                          fontWeight: FontWeight.w500,
                        ),
                      ),

                      const SizedBox(height: 4),

                      const Text(
                        'DUT Campus Streak',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 30,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.5,
                        ),
                      ),

                      const SizedBox(height: 12),

                      const Text(
                        'Check-in đúng giờ • Giữ streak • Theo dõi hành trình học tập',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: Colors.white70,
                          fontSize: 14,
                          height: 1.45,
                        ),
                      ),

                      const SizedBox(height: 34),

                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(22),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(28),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withOpacity(0.18),
                              blurRadius: 30,
                              offset: const Offset(0, 14),
                            ),
                          ],
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const Text(
                              'Đăng nhập',
                              style: TextStyle(
                                color: Color(0xFF12315C),
                                fontSize: 24,
                                fontWeight: FontWeight.w800,
                              ),
                            ),

                            const SizedBox(height: 6),

                            const Text(
                              'Sử dụng tài khoản đã đăng ký để tiếp tục.',
                              style: TextStyle(
                                color: Colors.black54,
                                fontSize: 13,
                              ),
                            ),

                            const SizedBox(height: 20),

                            TextField(
                              controller: _emailController,
                              keyboardType:
                                  TextInputType.emailAddress,
                              decoration: InputDecoration(
                                labelText: 'Email',
                                hintText: 'you@example.com',
                                prefixIcon: const Icon(
                                  Icons.mail_outline_rounded,
                                ),
                                filled: true,
                                fillColor:
                                    const Color(0xFFF4F7FB),
                                border: OutlineInputBorder(
                                  borderRadius:
                                      BorderRadius.circular(16),
                                  borderSide: BorderSide.none,
                                ),
                                focusedBorder: OutlineInputBorder(
                                  borderRadius:
                                      BorderRadius.circular(16),
                                  borderSide: const BorderSide(
                                    color: Color(0xFF0B63D8),
                                    width: 1.5,
                                  ),
                                ),
                              ),
                            ),

                            const SizedBox(height: 14),

                            TextField(
                              controller: _passwordController,
                              obscureText: _obscurePassword,
                              decoration: InputDecoration(
                                labelText: 'Mật khẩu',
                                prefixIcon: const Icon(
                                  Icons.lock_outline_rounded,
                                ),
                                suffixIcon: IconButton(
                                  tooltip: _obscurePassword
                                      ? 'Hiện mật khẩu'
                                      : 'Ẩn mật khẩu',
                                  onPressed: () {
                                    setState(() {
                                      _obscurePassword =
                                          !_obscurePassword;
                                    });
                                  },
                                  icon: Icon(
                                    _obscurePassword
                                        ? Icons.visibility_outlined
                                        : Icons.visibility_off_outlined,
                                  ),
                                ),
                                filled: true,
                                fillColor:
                                    const Color(0xFFF4F7FB),
                                border: OutlineInputBorder(
                                  borderRadius:
                                      BorderRadius.circular(16),
                                  borderSide: BorderSide.none,
                                ),
                                focusedBorder: OutlineInputBorder(
                                  borderRadius:
                                      BorderRadius.circular(16),
                                  borderSide: const BorderSide(
                                    color: Color(0xFF0B63D8),
                                    width: 1.5,
                                  ),
                                ),
                              ),
                            ),

                            if (_errorMessage != null) ...[
                              const SizedBox(height: 14),
                              Container(
                                padding:
                                    const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color:
                                      Colors.red.withOpacity(0.07),
                                  borderRadius:
                                      BorderRadius.circular(14),
                                ),
                                child: Row(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.start,
                                  children: [
                                    const Icon(
                                      Icons.error_outline_rounded,
                                      color: Colors.red,
                                      size: 20,
                                    ),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: Text(
                                        _errorMessage!,
                                        style: const TextStyle(
                                          color: Colors.red,
                                          fontSize: 13,
                                          height: 1.35,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],

                            const SizedBox(height: 20),

                            SizedBox(
                              height: 54,
                              child: FilledButton(
                                onPressed:
                                    _isLoading ? null : _login,
                                style: FilledButton.styleFrom(
                                  backgroundColor:
                                      const Color(0xFF075FD8),
                                  shape: RoundedRectangleBorder(
                                    borderRadius:
                                        BorderRadius.circular(16),
                                  ),
                                ),
                                child: _isLoading
                                    ? const SizedBox(
                                        width: 22,
                                        height: 22,
                                        child:
                                            CircularProgressIndicator(
                                          strokeWidth: 2,
                                          color: Colors.white,
                                        ),
                                      )
                                    : const Text(
                                        'Đăng nhập',
                                        style: TextStyle(
                                          fontSize: 16,
                                          fontWeight:
                                              FontWeight.w800,
                                        ),
                                      ),
                              ),
                            ),

                            const SizedBox(height: 12),

                            OutlinedButton(
                              onPressed: _isLoading
                                  ? null
                                  : () {
                                      Navigator.push(
                                        context,
                                        MaterialPageRoute(
                                          builder: (_) =>
                                              const SignUpScreen(),
                                        ),
                                      );
                                    },
                              style: OutlinedButton.styleFrom(
                                minimumSize:
                                    const Size.fromHeight(50),
                                side: const BorderSide(
                                  color: Color(0xFFB9C8DC),
                                ),
                                shape: RoundedRectangleBorder(
                                  borderRadius:
                                      BorderRadius.circular(16),
                                ),
                              ),
                              child: const Text(
                                'Tạo tài khoản mới',
                                style: TextStyle(
                                  fontWeight: FontWeight.w700,
                                  color: Color(0xFF174D91),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),

                      const SizedBox(height: 24),

                      const Text(
                        'DUT Campus Streak',
                        style: TextStyle(
                          color: Colors.white54,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class SignUpScreen extends StatefulWidget {
  const SignUpScreen({super.key});

  @override
  State<SignUpScreen> createState() => _SignUpScreenState();
}

class _SignUpScreenState extends State<SignUpScreen> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmController = TextEditingController();
  final _displayNameController = TextEditingController();

  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _confirmController.dispose();
    _displayNameController.dispose();
    super.dispose();
  }

  Future<void> _signUp() async {
    final email = _emailController.text.trim();
    final password = _passwordController.text;
    final confirm = _confirmController.text;
    final displayName = _displayNameController.text.trim();

    if (email.isEmpty || password.isEmpty || displayName.isEmpty) {
      setState(() => _error = 'Vui lòng nhập đầy đủ thông tin.');
      return;
    }

    if (password.length < 6) {
      setState(() => _error = 'Mật khẩu phải có ít nhất 6 ký tự.');
      return;
    }

    if (password != confirm) {
      setState(() => _error = 'Mật khẩu xác nhận không khớp.');
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final response = await supabase.auth.signUp(
        email: email,
        password: password,
        emailRedirectTo: 'io.dut.campusstreak://login-callback/',
        data: {
          'display_name': displayName,
        },
      );

      if (response.user == null) {
        throw Exception('Không thể tạo tài khoản.');
      }

      // Nếu Supabase đang yêu cầu xác nhận email, session có thể null.
      if (response.session == null) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Tài khoản đã tạo. Hãy kiểm tra email để xác nhận, sau đó đăng nhập.'),
          ),
        );
        Navigator.pop(context);
        return;
      }

      await ensureCurrentUserData(displayName: displayName);

      if (!mounted) return;
      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(builder: (_) => const HomeScreen()),
        (_) => false,
      );
    } on AuthException catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.message;
      });
    } catch (e) {
      debugPrint('Sign up error: $e');
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Không thể tạo tài khoản. Vui lòng thử lại.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFEAF4FF),
      appBar: AppBar(title: const Text('Tạo tài khoản')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Tạo tài khoản DUT Campus Streak',
                style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              const Text('Mật khẩu được Supabase Auth quản lý và không lưu trong profile của ứng dụng.'),
              const SizedBox(height: 24),
              TextField(
                controller: _displayNameController,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(
                  labelText: 'Tên hiển thị',
                  prefixIcon: Icon(Icons.person_outline),
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _emailController,
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(
                  labelText: 'Email',
                  prefixIcon: Icon(Icons.email_outlined),
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _passwordController,
                obscureText: true,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(
                  labelText: 'Mật khẩu',
                  prefixIcon: Icon(Icons.lock_outline),
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _confirmController,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: 'Nhập lại mật khẩu',
                  prefixIcon: Icon(Icons.lock_reset_outlined),
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 16),
              if (_error != null)
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.red.withOpacity(0.08),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(_error!, style: const TextStyle(color: Colors.red)),
                ),
              const SizedBox(height: 20),
              SizedBox(
                height: 52,
                child: FilledButton(
                  onPressed: _loading ? null : _signUp,
                  child: _loading
                      ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Text('Tạo tài khoản', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ============================================================
// PROFILE
// ============================================================

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _displayNameController = TextEditingController();
  final _emailController = TextEditingController();
  final _studentCodeController = TextEditingController();
  final _classNameController = TextEditingController();

  bool _loading = true;
  bool _saving = false;
  String? _avatarUrl;
  String? _selectedAvatarPath;
  String? _error;

  String _originalDisplayName = '';
  String _originalEmail = '';
  String _originalStudentCode = '';
  String _originalClassName = '';
  String? _originalAvatarUrl;

  @override
  void initState() {
    super.initState();

    _displayNameController.addListener(_onProfileChanged);
    _emailController.addListener(_onProfileChanged);
    _studentCodeController.addListener(_onProfileChanged);
    _classNameController.addListener(_onProfileChanged);

    _loadProfile();
  }

  @override
  void dispose() {
    _displayNameController.removeListener(_onProfileChanged);
    _emailController.removeListener(_onProfileChanged);
    _studentCodeController.removeListener(_onProfileChanged);
    _classNameController.removeListener(_onProfileChanged);

    _displayNameController.dispose();
    _emailController.dispose();
    _studentCodeController.dispose();
    _classNameController.dispose();
    super.dispose();
  }

  bool get _hasChanges {
    return _displayNameController.text.trim() != _originalDisplayName ||
        _emailController.text.trim().toLowerCase() != _originalEmail.trim().toLowerCase() ||
        _studentCodeController.text.trim() != _originalStudentCode ||
        _classNameController.text.trim() != _originalClassName ||
        _selectedAvatarPath != null;
  }

  void _onProfileChanged() {
    if (mounted) setState(() {});
  }

  Future<void> _loadProfile() async {
    try {
      final user = supabase.auth.currentUser;
      if (user == null) throw Exception('Chưa đăng nhập.');

      await ensureCurrentUserData();

      final userData = await supabase
          .from('users')
          .select('student_code, name, email, class_name')
          .eq('id', user.id)
          .single();

      final profileData = await supabase
          .from('profiles')
          .select('display_name, avatar_url')
          .eq('id', user.id)
          .single();

      final displayName =
          profileData['display_name']?.toString() ??
          userData['name']?.toString() ??
          'Sinh viên';
      final email =
          userData['email']?.toString() ?? user.email ?? '';
      final studentCode =
          userData['student_code']?.toString() ?? '';
      final className =
          userData['class_name']?.toString() ?? '';
      final avatarUrl = profileData['avatar_url']?.toString();

      _displayNameController.text = displayName;
      _emailController.text = email;
      _studentCodeController.text = studentCode;
      _classNameController.text = className;

      _originalDisplayName = displayName;
      _originalEmail = email;
      _originalStudentCode = studentCode;
      _originalClassName = className;
      _originalAvatarUrl = avatarUrl;

      if (!mounted) return;
      setState(() {
        _avatarUrl = avatarUrl;
        _selectedAvatarPath = null;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      debugPrint('Profile load error: $e');
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString();
      });
    }
  }

  Future<void> _pickAvatar() async {
    try {
      final picker = ImagePicker();
      final image = await picker.pickImage(
        source: ImageSource.gallery,
        imageQuality: 85,
        maxWidth: 800,
        maxHeight: 800,
      );

      if (image == null || !mounted) return;

      setState(() {
        _selectedAvatarPath = image.path;
      });
    } catch (e) {
      debugPrint('Pick avatar error: $e');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Không thể chọn ảnh: $e')),
      );
    }
  }

  Future<String?> _uploadSelectedAvatar(String userId) async {
    final imagePath = _selectedAvatarPath;
    if (imagePath == null) return _avatarUrl;

    final file = File(imagePath);
    if (!await file.exists()) {
      throw Exception('Không tìm thấy file avatar đã chọn.');
    }

    const pathSuffix = 'avatar.jpg';
    final path = '$userId/$pathSuffix';

    await supabase.storage.from('avatars').upload(
      path,
      file,
      fileOptions: const FileOptions(
        upsert: true,
        contentType: 'image/jpeg',
      ),
    );

    final publicUrl =
        supabase.storage.from('avatars').getPublicUrl(path);

    return '$publicUrl?v=${DateTime.now().millisecondsSinceEpoch}';
  }

  Future<void> _saveChanges() async {
    if (!_hasChanges || _saving) return;

    final user = supabase.auth.currentUser;
    if (user == null) return;

    final displayName = _displayNameController.text.trim();
    final email = _emailController.text.trim();
    final studentCode = _studentCodeController.text.trim();
    final className = _classNameController.text.trim();

    if (displayName.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Tên hiển thị không được để trống.')),
      );
      return;
    }


    setState(() => _saving = true);

    try {
      String? newAvatarUrl = _avatarUrl;
      // ----------------------------------------------------------
      // 1. Upload avatar nếu người dùng vừa chọn ảnh mới.
      // ----------------------------------------------------------
      if (_selectedAvatarPath != null) {
        newAvatarUrl = await _uploadSelectedAvatar(user.id);
      }

      // ----------------------------------------------------------
      // 2. Cập nhật dữ liệu hồ sơ trong database.
      // Unique index ở public.users sẽ chặn mã sinh viên trùng.
      // ----------------------------------------------------------
      try {
        await supabase.from('users').update({
          'student_code': studentCode,
          'class_name': className,
        }).eq('id', user.id);
      } on PostgrestException catch (e) {
        if (e.code == '23505') {
          throw Exception(
            'Mã sinh viên "$studentCode" đã được sử dụng bởi một tài khoản khác.',
          );
        }
        rethrow;
      }

      await supabase.from('profiles').update({
        'display_name': displayName,
        'avatar_url': newAvatarUrl,
        'updated_at': DateTime.now().toUtc().toIso8601String(),
      }).eq('id', user.id);

      // ----------------------------------------------------------
      // 3. Đổi email bằng Auth của Supabase.
      // Supabase sẽ gửi email xác nhận theo cấu hình Auth hiện tại.
      // Không cập nhật users.email ở đây vì Auth vẫn có thể giữ email
      // cũ cho tới khi người dùng xác nhận email mới.
      // ----------------------------------------------------------
      final emailChanged =
          email.toLowerCase() != _originalEmail.trim().toLowerCase();

      if (emailChanged) {
        if (email.isEmpty) {
          throw Exception('Email không được để trống.');
        }

        await supabase.auth.updateUser(
          UserAttributes(email: email),
        );
      }

      if (!mounted) return;

      setState(() {
        _avatarUrl = newAvatarUrl;
        _originalAvatarUrl = newAvatarUrl;
        _originalDisplayName = displayName;
        _originalStudentCode = studentCode;
        _originalClassName = className;
        if (emailChanged) {
          _originalEmail = email;
        }
        _selectedAvatarPath = null;
      });

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            emailChanged
                ? 'Đã gửi email xác nhận đến $email. Hãy xác nhận để hoàn tất đổi email.'
                : 'Đã lưu thay đổi hồ sơ.',
          ),
        ),
      );
    } on AuthException catch (e) {
      debugPrint('Save profile auth error: ${e.message}');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Không thể đổi email: ${e.message}')),
      );
    } catch (e) {
      debugPrint('Save profile error: $e');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Không thể lưu thay đổi: $e')),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _changePassword() async {
    final newPasswordController = TextEditingController();
    final confirmPasswordController = TextEditingController();
    bool obscureNew = true;
    bool obscureConfirm = true;
    String? dialogError;
    bool changing = false;

    final result = await showDialog<bool>(
      context: context,
      barrierDismissible: !changing,
      builder: (dialogContext) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            Future<void> submit() async {
              final newPassword = newPasswordController.text;
              final confirmPassword = confirmPasswordController.text;

              if (newPassword.length < 6) {
                setDialogState(() {
                  dialogError = 'Mật khẩu mới phải có ít nhất 6 ký tự.';
                });
                return;
              }

              if (newPassword != confirmPassword) {
                setDialogState(() {
                  dialogError = 'Mật khẩu xác nhận không khớp.';
                });
                return;
              }

              setDialogState(() {
                changing = true;
                dialogError = null;
              });

              try {
                await supabase.auth.updateUser(
                  UserAttributes(password: newPassword),
                );

                if (!mounted) return;

                // Mất focus trước khi đóng dialog để tránh lỗi
                // '_dependents.isEmpty' khi TextField đang active.
                FocusManager.instance.primaryFocus?.unfocus();
                Navigator.of(dialogContext).pop(true);
              } on AuthException catch (e) {
                setDialogState(() {
                  changing = false;
                  dialogError = e.message;
                });
              } catch (e) {
                setDialogState(() {
                  changing = false;
                  dialogError = 'Không thể đổi mật khẩu. Vui lòng thử lại.';
                });
                debugPrint('Change password error: $e');
              }
            }

            return AlertDialog(
              title: const Text('Đổi mật khẩu'),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    TextField(
                      controller: newPasswordController,
                      obscureText: obscureNew,
                      enabled: !changing,
                      decoration: InputDecoration(
                        labelText: 'Mật khẩu mới',
                        prefixIcon: const Icon(Icons.lock_outline),
                        suffixIcon: IconButton(
                          onPressed: changing
                              ? null
                              : () => setDialogState(() {
                                    obscureNew = !obscureNew;
                                  }),
                          icon: Icon(
                            obscureNew ? Icons.visibility : Icons.visibility_off,
                          ),
                        ),
                        border: const OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 14),
                    TextField(
                      controller: confirmPasswordController,
                      obscureText: obscureConfirm,
                      enabled: !changing,
                      decoration: InputDecoration(
                        labelText: 'Nhập lại mật khẩu mới',
                        prefixIcon: const Icon(Icons.lock_reset_outlined),
                        suffixIcon: IconButton(
                          onPressed: changing
                              ? null
                              : () => setDialogState(() {
                                    obscureConfirm = !obscureConfirm;
                                  }),
                          icon: Icon(
                            obscureConfirm ? Icons.visibility : Icons.visibility_off,
                          ),
                        ),
                        border: const OutlineInputBorder(),
                      ),
                    ),
                    if (dialogError != null) ...[
                      const SizedBox(height: 12),
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          dialogError!,
                          style: const TextStyle(color: Colors.red, fontSize: 13),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: changing
                      ? null
                      : () {
                          // Đảm bảo TextField mất focus trước khi
                          // route của dialog bị tháo khỏi widget tree.
                          FocusManager.instance.primaryFocus?.unfocus();
                          Navigator.of(dialogContext).pop(false);
                        },
                  child: const Text('Hủy'),
                ),
                FilledButton(
                  onPressed: changing ? null : submit,
                  child: changing
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Text('Đổi mật khẩu'),
                ),
              ],
            );
          },
        );
      },
    );

    // Không dispose controller ngay tại đây. showDialog() vừa trả về
    // nhưng route/TextField có thể chưa teardown xong.
    // Dispose sau frame kế tiếp để tránh lỗi Flutter:
    // '_dependents.isEmpty': is not true.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      newPasswordController.dispose();
      confirmPasswordController.dispose();
    });

    if (result == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Đã đổi mật khẩu thành công.')),
      );
    }
  }

  Future<void> _deleteAccount() async {
    if (_saving) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Xóa tài khoản?'),
        content: const Text(
          'Tài khoản và dữ liệu liên quan như hồ sơ, lịch học, check-in và ảnh đã tải lên sẽ bị xóa vĩnh viễn. Hành động này không thể hoàn tác.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Hủy'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Colors.red,
            ),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Xóa tài khoản'),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    setState(() => _saving = true);

    try {
      final response = await supabase.functions.invoke('delete-account');

      if (response.status < 200 || response.status >= 300) {
        final data = response.data;
        final message = data is Map
            ? data['error']?.toString()
            : null;
        throw Exception(message ?? 'Không thể xóa tài khoản.');
      }

      await supabase.auth.signOut();

      if (!mounted) return;

      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(builder: (_) => const LoginScreen()),
        (_) => false,
      );
    } on FunctionException catch (e) {
      debugPrint('Delete account function error: ${e.details}');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Không thể xóa tài khoản: ${e.details ?? e.reasonPhrase ?? 'Vui lòng thử lại.'}',
          ),
        ),
      );
    } catch (e) {
      debugPrint('Delete account error: $e');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Không thể xóa tài khoản: $e')),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _logout() async {
    try {
      await supabase.auth.signOut();
      if (!mounted) return;
      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(builder: (_) => const LoginScreen()),
        (_) => false,
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Không thể đăng xuất: $e')),
      );
    }
  }

  ImageProvider? get _previewImage {
    if (_selectedAvatarPath != null) {
      return FileImage(File(_selectedAvatarPath!));
    }

    if (_avatarUrl != null && _avatarUrl!.isNotEmpty) {
      return NetworkImage(_avatarUrl!);
    }

    return null;
  }

  Widget _buildEditableField({
    required String label,
    required TextEditingController controller,
    required IconData icon,
    TextInputType? keyboardType,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: TextField(
        controller: controller,
        keyboardType: keyboardType,
        textInputAction: TextInputAction.next,
        decoration: InputDecoration(
          labelText: label,
          prefixIcon: Icon(icon),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    if (_error != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Hồ sơ')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              _error!,
              textAlign: TextAlign.center,
            ),
          ),
        ),
      );
    }

    final image = _previewImage;
    final hasChanges = _hasChanges;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Hồ sơ'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Stack(
                children: [
                  CircleAvatar(
                    radius: 58,
                    backgroundImage: image,
                    child: image == null
                        ? const Icon(Icons.person, size: 58)
                        : null,
                  ),
                  Positioned(
                    right: 0,
                    bottom: 0,
                    child: Material(
                      color: const Color(0xFF005BAC),
                      shape: const CircleBorder(),
                      child: InkWell(
                        customBorder: const CircleBorder(),
                        onTap: _saving ? null : _pickAvatar,
                        child: const Padding(
                          padding: EdgeInsets.all(10),
                          child: Icon(
                            Icons.camera_alt,
                            color: Colors.white,
                            size: 20,
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 28),

            const Text(
              'Thông tin cá nhân',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.bold,
              ),
            ),

            const SizedBox(height: 16),

            _buildEditableField(
              label: 'Tên hiển thị',
              controller: _displayNameController,
              icon: Icons.person_outline,
            ),

            TextField(
              controller: _emailController,
              readOnly: _saving,
              keyboardType: TextInputType.emailAddress,
              textInputAction: TextInputAction.next,
              decoration: InputDecoration(
                labelText: 'Email',
                prefixIcon: const Icon(Icons.email_outlined),
                helperText: 'Đổi email sẽ gửi liên kết xác nhận từ Supabase.',
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
            ),
            const SizedBox(height: 14),

            _buildEditableField(
              label: 'Mã sinh viên',
              controller: _studentCodeController,
              icon: Icons.badge_outlined,
            ),

            _buildEditableField(
              label: 'Lớp',
              controller: _classNameController,
              icon: Icons.school_outlined,
            ),

            const SizedBox(height: 8),

            SizedBox(
              height: 52,
              child: FilledButton(
                onPressed: hasChanges && !_saving ? _saveChanges : null,
                child: _saving
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Text(
                        'Lưu thay đổi',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
              ),
            ),

            const SizedBox(height: 12),

            Text(
              hasChanges
                  ? 'Bạn đang có thay đổi chưa lưu.'
                  : 'Chưa có thay đổi nào.',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 12,
                color: hasChanges ? Colors.orange[700] : Colors.grey,
              ),
            ),

            const SizedBox(height: 28),
            const Divider(),
            const SizedBox(height: 12),

            OutlinedButton.icon(
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => const AboutContactScreen(),
                  ),
                );
              },
              icon: const Icon(Icons.info_outline_rounded),
              label: const Text('Liên hệ & Giới thiệu'),
            ),

            const SizedBox(height: 10),

            OutlinedButton.icon(
              onPressed: _saving ? null : _changePassword,
              icon: const Icon(Icons.lock_reset_outlined),
              label: const Text('Đổi mật khẩu'),
            ),

            const SizedBox(height: 10),

            OutlinedButton.icon(
              onPressed: _saving ? null : _deleteAccount,
              icon: const Icon(Icons.delete_forever, color: Colors.red),
              label: const Text(
                'Xóa tài khoản',
                style: TextStyle(color: Colors.red),
              ),
            ),

            const SizedBox(height: 10),

            OutlinedButton.icon(
              onPressed: _saving ? null : _logout,
              icon: const Icon(Icons.logout, color: Colors.red),
              label: const Text(
                'Đăng xuất',
                style: TextStyle(color: Colors.red),
              ),
            ),


          ],
        ),
      ),
    );
  }
}

// ============================================================
// ABOUT & CONTACT
// ============================================================

class AboutContactScreen extends StatelessWidget {
  const AboutContactScreen({super.key});

  static const Color _blue = Color(0xFF005BAC);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFEAF4FF),
      appBar: AppBar(
        title: const Text('Liên hệ & Giới thiệu'),
        backgroundColor: Colors.transparent,
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
        children: [
          Center(
            child: Container(
              width: 96,
              height: 96,
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(24),
                boxShadow: [
                  BoxShadow(
                    color: _blue.withOpacity(0.12),
                    blurRadius: 18,
                    offset: const Offset(0, 8),
                  ),
                ],
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(18),
                child: Image.asset(
                  'assets/icon/dut_campus_streak.png',
                  fit: BoxFit.cover,
                ),
              ),
            ),
          ),
          const SizedBox(height: 18),
          const Center(
            child: Text(
              'DUT Campus Streak',
              style: TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.w800,
                color: _blue,
              ),
            ),
          ),
          const SizedBox(height: 24),
          _infoCard(
            icon: Icons.person_outline_rounded,
            title: 'Tác giả / Nhóm phát triển',
            children: const [
              Text(
                'Nguyễn Tấn Phú',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
              ),
              SizedBox(height: 6),
              Text(
                'Sinh viên phát triển sản phẩm DUT Campus Streak.',
                style: TextStyle(color: Colors.black54, height: 1.4),
              ),
            ],
          ),
          const SizedBox(height: 14),
          _infoCard(
            icon: Icons.mail_outline_rounded,
            title: 'Liên hệ',
            children: const [
              Text(
                'phu759042@gmail.com',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
              ),
              SizedBox(height: 6),
              Text(
                'Email liên hệ về sản phẩm, góp ý và báo lỗi.',
                style: TextStyle(color: Colors.black54, height: 1.4),
              ),
            ],
          ),
          const SizedBox(height: 14),
          _infoCard(
            icon: Icons.copyright_rounded,
            title: 'Bản quyền & sở hữu trí tuệ',
            children: const [
              Text(
                'DUT Campus Streak © 2026',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
              ),
              SizedBox(height: 8),
              Text(
                'Mã nguồn, giao diện, thiết kế và nội dung do tác giả tự phát triển được bảo lưu quyền sở hữu trí tuệ trong phạm vi pháp luật áp dụng. Các thư viện, SDK và thành phần của bên thứ ba tuân theo giấy phép riêng của chúng.',
                style: TextStyle(color: Colors.black54, height: 1.5),
              ),
            ],
          ),
          const SizedBox(height: 14),
          _infoCard(
            icon: Icons.info_outline_rounded,
            title: 'Về sản phẩm',
            children: const [
              Text(
                'DUT Campus Streak hỗ trợ sinh viên theo dõi lịch học, check-in lớp học, xác minh phòng, duy trì streak và xem thành tích.',
                style: TextStyle(color: Colors.black54, height: 1.5),
              ),
            ],
          ),
        ],
      ),
    );
  }

  static Widget _infoCard({
    required IconData icon,
    required String title,
    required List<Widget> children,
  }) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color.fromARGB(255, 255, 255, 255),
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 14,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: const Color(0xFFEAF4FF),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: _blue),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 8),
                ...children,
              ],
            ),
          ),
        ],
      ),
    );
  }
}


// ============================================================
// HOME
// ============================================================

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() =>
      _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  List<ClassSession> todayClasses = [];

  bool isLoadingClasses = true;
  String? classError;
  DateTime? _loadedClassesDate;

  Map<String, dynamic>? profile;

  bool isLoadingProfile = true;
  String? profileError;
  int streak = 0;
  bool todayStreakCompleted = false;

  Future<int> _loadStreak() async {
    final user = supabase.auth.currentUser;
    if (user == null) return 0;

    try {
      // Home and Leaderboard intentionally use the same RPC source of truth.
      // The RPC implements the rule: an incomplete TODAY is still in
      // progress and keeps the previous streak; only a finished school
      // day below 75% breaks the streak on the following day.
      final data = await supabase.rpc('get_leaderboard');
      final rows = (data as List)
          .map((row) => Map<String, dynamic>.from(row as Map))
          .toList();

      for (final row in rows) {
        if (row['user_id']?.toString() == user.id) {
          return (row['current_streak'] as num?)?.toInt() ?? 0;
        }
      }

      return 0;
    } catch (e) {
      debugPrint('Load streak error: $e');
      return 0;
    }
  }

  @override
void initState() {
  super.initState();

  _loadProfile();
  _loadTodayClasses();
  _loadStreakData();
}

Future<void> _loadStreakData() async {
  try {
    final loadedStreak = await _loadStreak();

    if (!mounted) return;

    setState(() {
      streak = loadedStreak;
    });
  } catch (e) {
    debugPrint('Load streak error: $e');
  }
}

  // ==========================================================
  // LOAD PROFILE
  // ==========================================================

  Future<void> _loadProfile() async {
    try {
      final user = supabase.auth.currentUser;

      if (user == null) {
        throw Exception('Chưa có người dùng đăng nhập.');
      }

      await ensureCurrentUserData();

      final userData = await supabase
          .from('users')
          .select('student_code, name, email, class_name')
          .eq('id', user.id)
          .single();

      final profileData = await supabase
          .from('profiles')
          .select('display_name, avatar_url')
          .eq('id', user.id)
          .maybeSingle();

      final merged = <String, dynamic>{
        ...Map<String, dynamic>.from(userData),
        if (profileData != null)
          ...Map<String, dynamic>.from(profileData),
      };

      if (!mounted) return;

      setState(() {
        profile = merged;
        isLoadingProfile = false;
        profileError = null;
      });

      debugPrint('Loaded profile: $merged');
    } catch (e) {
      if (!mounted) return;

      setState(() {
        profileError = e.toString();
        isLoadingProfile = false;
      });

      debugPrint('Load profile error: $e');
    }
  }

  // ==========================================================
  // LOAD TODAY CLASSES
  // ==========================================================

  Future<void> _loadTodayClasses() async {
    try {
      if (mounted) {
        setState(() {
          isLoadingClasses = true;
          classError = null;
        });
      }

      final user = supabase.auth.currentUser;

      if (user == null) {
        throw Exception('Chưa đăng nhập.');
      }

      final today = DateTime.now().weekday;

      final data = await supabase
          .from('class_sessions')
          .select('''
            id,
            room,
            start_time,
            end_time,
            teacher,
            day_of_week,
            is_active,
            subjects (
              name,
              subject_code,
              teacher
            )
          ''')
          .eq('user_id', user.id)
          .eq('day_of_week', today)
          .eq('is_active', true)
          .order('start_time');

      final rawClasses = (data as List)
          .map(
            (item) => ClassSession.fromMap(
              Map<String, dynamic>.from(item),
            ),
          )
          .toList();

      // Đồng bộ nhắc lịch học cho TOÀN BỘ tuần, không chỉ lịch hôm nay.
      // MSTEAM/GDTC vẫn được nhắc vì đây vẫn là tiết học thật.
      final allScheduleData = await supabase
          .from('class_sessions')
          .select('''
            id,
            room,
            start_time,
            end_time,
            teacher,
            day_of_week,
            is_active,
            subjects (
              name,
              subject_code,
              teacher
            )
          ''')
          .eq('user_id', user.id)
          .eq('is_active', true);

      final allScheduleClasses = (allScheduleData as List)
          .map(
            (item) => ClassSession.fromMap(
              Map<String, dynamic>.from(item),
            ),
          )
          .toList();

      await NotificationService.syncSchedule(allScheduleClasses);
      final pendingCount = await NotificationService.pendingCount();
      debugPrint('Scheduled class notifications: $pendingCount');

      // Đồng bộ trạng thái đã VERIFIED hôm nay.
      final now = DateTime.now();
      final startOfToday = DateTime(
        now.year,
        now.month,
        now.day,
      );
      final startOfTomorrow =
          startOfToday.add(const Duration(days: 1));

      final checkInData = await supabase
          .from('check_ins')
          .select('class_session_id')
          .eq('user_id', user.id)
          .eq('verification_status', 'verified')
          .gte(
            'checked_in_at',
            startOfToday.toUtc().toIso8601String(),
          )
          .lt(
            'checked_in_at',
            startOfTomorrow.toUtc().toIso8601String(),
          );

      final verifiedTodayIds = (checkInData as List)
          .map(
            (row) => row['class_session_id']?.toString(),
          )
          .whereType<String>()
          .toSet();

      final classes = rawClasses
          .map(
            (item) => item.copyWith(
              completed:
                  !item.isCheckInExcluded &&
                  verifiedTodayIds.contains(item.id),
            ),
          )
          .toList()
        ..sort((a, b) => _timeToMinutes(a.startTime)
            .compareTo(_timeToMinutes(b.startTime)));

      if (!mounted) return;

      setState(() {
        todayClasses = classes;
        _loadedClassesDate = DateTime.now();
        isLoadingClasses = false;
        classError = null;
      });

      debugPrint(
        'Loaded ${classes.length} classes for weekday $today. '
        'Verified today: ${verifiedTodayIds.length}',
      );
    } catch (e) {
      if (!mounted) return;

      setState(() {
        isLoadingClasses = false;
        classError = e.toString();
      });

      debugPrint('Load classes error: $e');
    }
  }

  // ==========================================================
  // BUILD CLASS LIST
  // ==========================================================

  bool get _isTodayStreakComplete {
    final loadedDate = _loadedClassesDate;
    final now = DateTime.now();

    // Nếu đã sang ngày mới nhưng Home chưa reload lịch, ngọn lửa vẫn
    // phải trở về màu xám ngay lập tức.
    if (loadedDate == null ||
        loadedDate.year != now.year ||
        loadedDate.month != now.month ||
        loadedDate.day != now.day) {
      return false;
    }

    final checkInClasses = todayClasses
        .where((item) => !item.isCheckInExcluded)
        .toList();

    // Nếu hôm nay có lịch nhưng toàn bộ đều là môn không cần check-in
    // (MSTEAM/GDTC), ngày này vẫn được tính là một ngày hoàn thành streak.
    if (checkInClasses.isEmpty) return todayClasses.isNotEmpty;

    final completedCount =
        checkInClasses.where((item) => item.completed).length;

    return completedCount / checkInClasses.length >= 0.75;
  }

  Widget _buildTodayClasses() {
    if (isLoadingClasses) {
      return const Padding(
        padding: EdgeInsets.all(28),
        child: Center(
          child: CircularProgressIndicator(),
        ),
      );
    }

    if (classError != null) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.red.withOpacity(0.07),
          borderRadius: BorderRadius.circular(18),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Không thể tải lịch học.',
              style: TextStyle(
                color: Colors.red,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              classError!,
              style: const TextStyle(
                color: Colors.red,
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 10),
            OutlinedButton(
              onPressed: _loadTodayClasses,
              child: const Text('Thử lại'),
            ),
          ],
        ),
      );
    }

    if (todayClasses.isEmpty) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(
          horizontal: 20,
          vertical: 28,
        ),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(22),
        ),
        child: const Column(
          children: [
            Icon(
              Icons.event_available_rounded,
              size: 42,
              color: Color(0xFF2876C7),
            ),
            SizedBox(height: 10),
            Text(
              'Hôm nay không có lịch học.',
              style: TextStyle(
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      );
    }

    return Column(
      children: todayClasses.map((classSession) {
        return Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Material(
            color: Colors.white,
            borderRadius: BorderRadius.circular(18),
            child: InkWell(
              borderRadius: BorderRadius.circular(18),
              onTap: () async {
                if (classSession.isCheckInExcluded) {
                  await showDialog<void>(
                    context: context,
                    builder: (_) => AlertDialog(
                      title: const Text('Không cần Check-in'),
                      content: Text(
                        '${classSession.subject} chỉ hiển thị '
                        'để bạn theo dõi lịch học.\n\n'
                        'Môn này không tính vào Check-in và streak.',
                      ),
                      actions: [
                        TextButton(
                          onPressed: () => Navigator.pop(context),
                          child: const Text('Đã hiểu'),
                        ),
                      ],
                    ),
                  );
                } else {
                  await Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => MissionScreen(
                        classSession: classSession,
                      ),
                    ),
                  );
                }

                // Check-in success quay về Home bằng popUntil.
                // Cập nhật card ngay mà không cần mở lại app.
                if (!mounted) return;
                await _loadTodayClasses();
                await _loadStreakData();
              },
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 14,
                ),
                child: Row(
                  children: [
                    // Giữ nguyên logo/mốc nhận diện bên trái.
                    Container(
                      width: 48,
                      height: 48,
                      decoration: BoxDecoration(
                        color: const Color(0xFFEAF4FF),
                        borderRadius:
                            BorderRadius.circular(14),
                      ),
                      child: const Icon(
                        Icons.school_rounded,
                        color: Color(0xFF005BAC),
                      ),
                    ),

                    const SizedBox(width: 12),

                    Expanded(
                      child: Column(
                        crossAxisAlignment:
                            CrossAxisAlignment.start,
                        children: [
                          Text(
                            classSession.subject,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(height: 5),
                          Text(
                            '${classSession.time} • ${classSession.room}',
                            style: const TextStyle(
                              color: Colors.black54,
                              fontSize: 13,
                            ),
                          ),
                          if (classSession.teacher.isNotEmpty) ...[
                            const SizedBox(height: 3),
                            Text(
                              classSession.teacher,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Colors.black45,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),

                    const SizedBox(width: 8),

                    if (classSession.isCheckInExcluded)
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 5,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.black.withOpacity(0.06),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Text(
                          'Không Check-in',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: Colors.black54,
                          ),
                        ),
                      )
                    else if (classSession.completed)
                      const Padding(
                        padding: EdgeInsets.only(right: 6),
                        child: Icon(
                          Icons.check_circle_rounded,
                          color: Colors.green,
                          size: 23,
                        ),
                      ),

                    const Icon(
                      Icons.chevron_right_rounded,
                      color: Colors.black38,
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      }).toList(),
    );
  }

  // ==========================================================
  // BUILD
  // ==========================================================

  Widget _menuTile({
    required IconData icon,
    required String title,
    required VoidCallback onTap,
  }) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: SizedBox(
          height: 128,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  icon,
                  size: 34,
                  color: const Color(0xFF2474BE),
                ),
                const SizedBox(height: 10),
                Text(
                  title,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: Color(0xFF2469A9),
                    fontWeight: FontWeight.w700,
                    fontSize: 14,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  int _timeToMinutes(String value) {
    final parts = value.split(':');
    final hour = int.tryParse(parts.isNotEmpty ? parts[0] : '') ?? 0;
    final minute = int.tryParse(parts.length > 1 ? parts[1] : '') ?? 0;
    return hour * 60 + minute;
  }

  String _weekdayLabel(int weekday) {
    const names = [
      'Thứ Hai',
      'Thứ Ba',
      'Thứ Tư',
      'Thứ Năm',
      'Thứ Sáu',
      'Thứ Bảy',
      'Chủ Nhật',
    ];
    return names[(weekday - 1).clamp(0, 6)];
  }

  @override
  Widget build(BuildContext context) {
    if (isLoadingProfile) {
      return const Scaffold(
        body: Center(
          child: CircularProgressIndicator(),
        ),
      );
    }

    if (profileError != null) {
      return Scaffold(
        backgroundColor: const Color(0xFFEAF4FF),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.cloud_off_rounded,
                  size: 52,
                  color: Color(0xFF005BAC),
                ),
                const SizedBox(height: 14),
                const Text(
                  'Không thể tải thông tin sinh viên.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  profileError!,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 18),
                FilledButton(
                  onPressed: _loadProfile,
                  child: const Text('Thử lại'),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final displayName =
        profile?['display_name'] ??
        profile?['name'] ??
        'Sinh viên';

    final avatarUrl =
        profile?['avatar_url']?.toString();

    final studentCode =
        profile?['student_code'] ?? '';

    final className =
        profile?['class_name'] ?? '';

    final now = DateTime.now();
    final weekday = _weekdayLabel(now.weekday);
    final monthName = now.month.toString();
    final dayNumber = now.day.toString();

    final currentMinutes = now.hour * 60 + now.minute;

    // Chọn môn hiển thị chính theo trạng thái thực tế trong ngày:
    // - Trước khi môn đầu tiên bắt đầu: hiển thị môn đầu tiên.
    // - Đang trong một môn: giữ nguyên môn đang học cho tới khi kết thúc.
    // - Đang ở khoảng nghỉ giữa hai môn: hiển thị môn kế tiếp.
    // - Đã kết thúc môn cuối: vẫn giữ môn cuối cùng, không quay lại môn đầu.
    ClassSession? nextClass;
    if (todayClasses.isNotEmpty) {
      final sortedTodayClasses = List<ClassSession>.from(todayClasses)
        ..sort((a, b) => _timeToMinutes(a.startTime)
            .compareTo(_timeToMinutes(b.startTime)));

      nextClass = sortedTodayClasses.firstWhere(
        (item) => _timeToMinutes(item.endTime) > currentMinutes,
        orElse: () => sortedTodayClasses.last,
      );
    }

    return Scaffold(
      backgroundColor: const Color(0xFFEAF4FF),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 0, 18, 12),
          child: Container(
            height: 62,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(32),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.08),
                  blurRadius: 18,
                  offset: const Offset(0, 6),
                ),
              ],
            ),
            child: Row(
              children: [
                Expanded(
                  child: Container(
                    margin: const EdgeInsets.all(5),
                    decoration: BoxDecoration(
                      color: const Color(0xFFEAF4FF),
                      borderRadius: BorderRadius.circular(28),
                    ),
                    child: const Icon(
                      Icons.home_rounded,
                      color: Color(0xFF2474BE),
                    ),
                  ),
                ),
                Expanded(
                  child: InkWell(
                    borderRadius: BorderRadius.circular(28),
                    onTap: () async {
                      await Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => const ProfileScreen(),
                        ),
                      );
                      if (mounted) {
                        await _loadProfile();
                      }
                    },
                    child: const Icon(
                      Icons.person_outline_rounded,
                      color: Colors.black45,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () async {
            await Future.wait([
              _loadProfile(),
              _loadTodayClasses(),
              _loadStreakData(),
            ]);
          },
          child: CustomScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    16,
                    14,
                    16,
                    8,
                  ),
                  child: Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [
                          Color(0xFF1877C9),
                          Color(0xFF0756A9),
                        ],
                      ),
                      borderRadius:
                          BorderRadius.circular(22),
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFF005BAC)
                              .withOpacity(0.22),
                          blurRadius: 18,
                          offset: const Offset(0, 8),
                        ),
                      ],
                    ),
                    child: Row(
                      children: [
                        InkWell(
                          borderRadius:
                              BorderRadius.circular(30),
                          onTap: () async {
                            await Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (_) =>
                                    const ProfileScreen(),
                              ),
                            );
                            if (mounted) {
                              await _loadProfile();
                            }
                          },
                          child: CircleAvatar(
                            radius: 27,
                            backgroundColor: Colors.white,
                            backgroundImage:
                                avatarUrl != null &&
                                        avatarUrl!.isNotEmpty
                                    ? NetworkImage(
                                        avatarUrl!,
                                      )
                                    : null,
                            child: avatarUrl == null ||
                                    avatarUrl!.isEmpty
                                ? const Icon(
                                    Icons.person_rounded,
                                    color: Color(0xFF6E7F95),
                                    size: 30,
                                  )
                                : null,
                          ),
                        ),
                        const SizedBox(width: 13),
                        Expanded(
                          child: Column(
                            crossAxisAlignment:
                                CrossAxisAlignment.start,
                            children: [
                              Text(
                                displayName.toString(),
                                maxLines: 1,
                                overflow:
                                    TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 19,
                                  fontWeight:
                                      FontWeight.w800,
                                ),
                              ),
                              const SizedBox(height: 3),
                              Text(
                                (profile?['email']?.toString().trim().isNotEmpty == true)
                                    ? profile!['email'].toString()
                                    : (studentCode.toString().isEmpty
                                        ? className.toString()
                                        : '$studentCode${className.toString().isEmpty ? '' : ' • $className'}'),
                                maxLines: 1,
                                overflow:
                                    TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: Colors.white70,
                                  fontSize: 12,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Container(
                          width: 42,
                          height: 42,
                          decoration: BoxDecoration(
                            color: Colors.white
                                .withOpacity(0.14),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(
                            Icons.notifications_none_rounded,
                            color: Colors.white,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),

              // Date + next class card.
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    16,
                    10,
                    16,
                    8,
                  ),
                  child: Container(
                    height: 152,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius:
                          BorderRadius.circular(22),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black
                              .withOpacity(0.05),
                          blurRadius: 14,
                          offset: const Offset(0, 5),
                        ),
                      ],
                    ),
                    child: Row(
                      children: [
                        SizedBox(
                          width: 112,
                          child: Padding(
                            padding:
                                const EdgeInsets.fromLTRB(
                              20,
                              18,
                              12,
                              18,
                            ),
                            child: Column(
                              crossAxisAlignment:
                                  CrossAxisAlignment.start,
                              children: [
                                Text(
                                  weekday,
                                  style: const TextStyle(
                                    fontSize: 16,
                                    fontWeight:
                                        FontWeight.w800,
                                  ),
                                ),
                                const SizedBox(height: 7),
                                Text(
                                  'Tháng $monthName',
                                  style: const TextStyle(
                                    color: Colors.black45,
                                    fontSize: 14,
                                  ),
                                ),
                                const SizedBox(height: 1),
                                Text(
                                  dayNumber,
                                  style: const TextStyle(
                                    color:
                                        Color(0xFF2474BE),
                                    fontSize: 42,
                                    height: 0.95,
                                    fontWeight:
                                        FontWeight.w800,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        Container(
                          width: 1,
                          margin: const EdgeInsets.symmetric(
                            vertical: 20,
                          ),
                          color: const Color(0xFFE3E8EF),
                        ),
                        Expanded(
                          child: Padding(
                            padding:
                                const EdgeInsets.all(18),
                            child: nextClass == null
                                ? const Column(
                                    mainAxisAlignment:
                                        MainAxisAlignment.center,
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        'Không có lớp hôm nay',
                                        style: TextStyle(
                                          fontSize: 17,
                                          fontWeight:
                                              FontWeight.w800,
                                        ),
                                      ),
                                      SizedBox(height: 6),
                                      Text(
                                        'Bạn có thể nghỉ ngơi hoặc xem lịch học.',
                                        style: TextStyle(
                                          color: Colors.black45,
                                          fontSize: 12,
                                        ),
                                      ),
                                    ],
                                  )
                                : Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    mainAxisAlignment:
                                        MainAxisAlignment.center,
                                    children: [
                                      Text(
                                        nextClass.subject,
                                        maxLines: 1,
                                        overflow:
                                            TextOverflow.ellipsis,
                                        style: const TextStyle(
                                          fontSize: 17,
                                          fontWeight:
                                              FontWeight.w800,
                                        ),
                                      ),
                                      const SizedBox(height: 7),
                                      Text(
                                        nextClass.time,
                                        style: const TextStyle(
                                          fontSize: 14,
                                          color: Colors.black87,
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        'Phòng ${nextClass.room}',
                                        style: const TextStyle(
                                          fontSize: 13,
                                          color: Colors.black45,
                                        ),
                                      ),
                                    ],
                                  ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),

              // Lịch học hôm nay.
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    16,
                    10,
                    16,
                    4,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Lịch học hôm nay',
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 10),
                      _buildTodayClasses(),
                    ],
                  ),
                ),
              ),

              // Streak summary.
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    16,
                    8,
                    16,
                    10,
                  ),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 18,
                      vertical: 15,
                    ),
                    decoration: BoxDecoration(
                      color: const Color(0xFF005BAC),
                      borderRadius:
                          BorderRadius.circular(20),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          Icons.local_fire_department_rounded,
                          color: _isTodayStreakComplete
                              ? const Color(0xFFFF8A00)
                              : Colors.grey.shade400,
                          size: 32,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment:
                                CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'Streak hiện tại',
                                style: TextStyle(
                                  color: Colors.white70,
                                  fontSize: 12,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                '$streak ngày',
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 21,
                                  fontWeight:
                                      FontWeight.w800,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Text(
                          streak == 0
                              ? 'Bắt đầu ngay'
                              : 'Tiếp tục nhé!',
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w700,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),

              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    16,
                    8,
                    16,
                    10,
                  ),
                  child: Row(
                    children: [
                      const Expanded(
                        child: Text(
                          'Truy cập nhanh',
                          style: TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                      TextButton(
                        onPressed: () {
                          Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) =>
                                  const ScheduleScreen(),
                            ),
                          );
                        },
                        child: const Text('Lịch học'),
                      ),
                    ],
                  ),
                ),
              ),

              SliverPadding(
                padding: const EdgeInsets.fromLTRB(
                  16,
                  0,
                  16,
                  10,
                ),
                sliver: SliverGrid(
                  delegate: SliverChildListDelegate([
                    _menuTile(
                      icon: Icons.calendar_month_rounded,
                      title: 'Thời khóa biểu',
                      onTap: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) =>
                                const ScheduleScreen(),
                          ),
                        );
                      },
                    ),
                    _menuTile(
                      icon: Icons.leaderboard_rounded,
                      title: 'Xếp hạng',
                      onTap: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) =>
                                const LeaderboardScreen(),
                          ),
                        );
                      },
                    ),
                    _menuTile(
                      icon: Icons.emoji_events_rounded,
                      title: 'Thành tích',
                      onTap: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) =>
                                const AchievementsScreen(),
                          ),
                        );
                      },
                    ),
                    _menuTile(
                      icon: Icons.camera_alt_rounded,
                      title: 'Check-in hôm nay',
                      onTap: () async {
                        await Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) =>
                                const TodayCheckInsScreen(),
                          ),
                        );
                      },
                    ),
                  ]),
                  gridDelegate:
                      const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 2,
                    mainAxisSpacing: 12,
                    crossAxisSpacing: 12,
                    childAspectRatio: 1.12,
                  ),
                ),
              ),

              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    16,
                    8,
                    16,
                    24,
                  ),
                  child: Text(
                    'DUT Campus Streak • Học đều mỗi ngày',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.black38,
                      fontSize: 12,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

}

// ============================================================
// TODAY CHECK-INS
// ============================================================

class TodayCheckInsScreen extends StatefulWidget {
  const TodayCheckInsScreen({super.key});

  @override
  State<TodayCheckInsScreen> createState() =>
      _TodayCheckInsScreenState();
}

class _TodayCheckInsScreenState
    extends State<TodayCheckInsScreen> {
  List<ClassSession> checkedInClasses = [];
  bool isLoading = true;
  String? errorMessage;
  bool hasClassesToday = false;

  @override
  void initState() {
    super.initState();
    _loadCheckedInToday();
  }

  Future<void> _loadCheckedInToday() async {
    try {
      final user = supabase.auth.currentUser;
      if (user == null) {
        throw Exception('Chưa đăng nhập.');
      }

      final today = DateTime.now().weekday;

      final data = await supabase
          .from('class_sessions')
          .select('''
            id,
            room,
            start_time,
            end_time,
            teacher,
            day_of_week,
            is_active,
            subjects (
              name,
              subject_code,
              teacher
            )
          ''')
          .eq('user_id', user.id)
          .eq('day_of_week', today)
          .eq('is_active', true)
          .order('start_time');

      final classes = (data as List)
          .map(
            (item) => ClassSession.fromMap(
              Map<String, dynamic>.from(item),
            ),
          )
          .toList();

      final now = DateTime.now();
      final startOfToday = DateTime(
        now.year,
        now.month,
        now.day,
      );
      final startOfTomorrow =
          startOfToday.add(const Duration(days: 1));

      final checkInData = await supabase
          .from('check_ins')
          .select('class_session_id')
          .eq('user_id', user.id)
          .eq('verification_status', 'verified')
          .gte(
            'checked_in_at',
            startOfToday.toUtc().toIso8601String(),
          )
          .lt(
            'checked_in_at',
            startOfTomorrow.toUtc().toIso8601String(),
          );

      final verifiedIds = (checkInData as List)
          .map(
            (row) => row['class_session_id']?.toString(),
          )
          .whereType<String>()
          .toSet();

      final result = classes
          .where((item) => verifiedIds.contains(item.id))
          .map((item) => item.copyWith(completed: true))
          .toList();

      if (!mounted) return;

      setState(() {
        hasClassesToday = classes.isNotEmpty;
        checkedInClasses = result;
        isLoading = false;
        errorMessage = null;
      });
    } catch (e) {
      if (!mounted) return;

      setState(() {
        isLoading = false;
        errorMessage = e.toString();
      });

      debugPrint('Load today check-ins error: $e');
    }
  }

  Widget _buildContent() {
    if (isLoading) {
      return const Center(
        child: CircularProgressIndicator(),
      );
    }

    if (errorMessage != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.error_outline_rounded,
                size: 46,
                color: Colors.red,
              ),
              const SizedBox(height: 12),
              const Text(
                'Không thể tải dữ liệu Check-in.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                errorMessage!,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.black54,
                  fontSize: 13,
                ),
              ),
              const SizedBox(height: 14),
              OutlinedButton(
                onPressed: _loadCheckedInToday,
                child: const Text('Thử lại'),
              ),
            ],
          ),
        ),
      );
    }

    if (!hasClassesToday) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.event_available_rounded,
                size: 56,
                color: Color(0xFF2876C7),
              ),
              SizedBox(height: 14),
              Text(
                'Hôm nay không có môn học',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                ),
              ),
              SizedBox(height: 7),
              Text(
                'Không có lớp nào trong lịch học hôm nay.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Colors.black45,
                  fontSize: 13,
                ),
              ),
            ],
          ),
        ),
      );
    }

    if (checkedInClasses.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.check_circle_outline_rounded,
                size: 56,
                color: Colors.black26,
              ),
              SizedBox(height: 14),
              Text(
                'Chưa có môn nào được Check-in',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                ),
              ),
              SizedBox(height: 7),
              Text(
                'Các môn chưa Check-in sẽ không xuất hiện ở đây.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Colors.black45,
                  fontSize: 13,
                ),
              ),
            ],
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadCheckedInToday,
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        itemCount: checkedInClasses.length,
        separatorBuilder: (_, __) =>
            const SizedBox(height: 10),
        itemBuilder: (_, index) {
          final classSession = checkedInClasses[index];

          return Material(
            color: Colors.white,
            borderRadius: BorderRadius.circular(18),
            child: InkWell(
              borderRadius: BorderRadius.circular(18),
              onTap: () async {
                await Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => MissionScreen(
                      classSession: classSession,
                    ),
                  ),
                );

                if (mounted) {
                  await _loadCheckedInToday();
                }
              },
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 14,
                ),
                child: Row(
                  children: [
                    Container(
                      width: 48,
                      height: 48,
                      decoration: BoxDecoration(
                        color: const Color(0xFFEAF4FF),
                        borderRadius:
                            BorderRadius.circular(14),
                      ),
                      child: const Icon(
                        Icons.school_rounded,
                        color: Color(0xFF005BAC),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment:
                            CrossAxisAlignment.start,
                        children: [
                          Text(
                            classSession.subject,
                            maxLines: 1,
                            overflow:
                                TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(height: 5),
                          Text(
                            '${classSession.time} • ${classSession.room}',
                            style: const TextStyle(
                              color: Colors.black54,
                              fontSize: 13,
                            ),
                          ),
                          if (classSession.teacher.isNotEmpty) ...[
                            const SizedBox(height: 3),
                            Text(
                              classSession.teacher,
                              maxLines: 1,
                              overflow:
                                  TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Colors.black45,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    const Icon(
                      Icons.check_circle_rounded,
                      color: Colors.green,
                      size: 23,
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFEAF4FF),
      appBar: AppBar(
        title: const Text('Check-in hôm nay'),
        backgroundColor: const Color(0xFFEAF4FF),
        surfaceTintColor: Colors.transparent,
      ),
      body: SafeArea(
        child: _buildContent(),
      ),
    );
  }
}

// ============================================================
// ACHIEVEMENTS
// ============================================================

class Achievement {
  final String id;
  final String title;
  final String description;
  final IconData icon;
  final int target;
  final bool isStreakAchievement;
  final int progress;

  const Achievement({
    required this.id,
    required this.title,
    required this.description,
    required this.icon,
    required this.target,
    required this.isStreakAchievement,
    required this.progress,
  });

  bool get unlocked => progress >= target;

  double get progressRatio {
    if (target <= 0) return 1;
    return (progress / target).clamp(0.0, 1.0).toDouble();
  }

  String get progressText {
    if (unlocked) return 'Đã mở khóa';
    return isStreakAchievement
        ? '$progress / $target ngày streak'
        : '$progress / $target check-in';
  }
}

class AchievementStats {
  final int totalCheckIns;
  final int longestStreak;

  const AchievementStats({
    required this.totalCheckIns,
    required this.longestStreak,
  });
}

Future<AchievementStats> loadAchievementStats() async {
  final user = supabase.auth.currentUser;

  if (user == null) {
    return const AchievementStats(
      totalCheckIns: 0,
      longestStreak: 0,
    );
  }

  final response = await supabase.rpc(
    'get_my_achievement_stats',
  );

  if (response is! List || response.isEmpty) {
    return const AchievementStats(
      totalCheckIns: 0,
      longestStreak: 0,
    );
  }

  final row = Map<String, dynamic>.from(response.first as Map);

  final totalCheckIns =
      (row['total_check_ins'] as num?)?.toInt() ?? 0;

  final longestStreak =
      (row['longest_streak'] as num?)?.toInt() ?? 0;

  debugPrint(
    'Achievement stats: '
    'check-ins=$totalCheckIns, '
    'longest-streak=$longestStreak',
  );

  return AchievementStats(
    totalCheckIns: totalCheckIns,
    longestStreak: longestStreak,
  );
}

class AchievementsScreen extends StatefulWidget {
  const AchievementsScreen({super.key});

  @override
  State<AchievementsScreen> createState() => _AchievementsScreenState();
}

class _AchievementsScreenState extends State<AchievementsScreen> {
  bool isLoading = true;
  String? errorMessage;
  AchievementStats stats = const AchievementStats(
    totalCheckIns: 0,
    longestStreak: 0,
  );

  @override
  void initState() {
    super.initState();
    _loadAchievements();
  }

  Future<void> _loadAchievements() async {
    try {
      if (mounted) {
        setState(() {
          isLoading = true;
          errorMessage = null;
        });
      }

      final loadedStats = await loadAchievementStats();

      if (!mounted) return;

      setState(() {
        stats = loadedStats;
        isLoading = false;
        errorMessage = null;
      });
    } catch (e) {
      debugPrint('Load achievements error: $e');

      if (!mounted) return;

      setState(() {
        isLoading = false;
        errorMessage = e.toString();
      });
    }
  }

  List<Achievement> _buildAchievements() {
    return [
      Achievement(
        id: 'first_check_in',
        title: 'Bước đầu tiên',
        description: 'Hoàn thành check-in đầu tiên.',
        icon: Icons.flag_rounded,
        target: 1,
        isStreakAchievement: false,
        progress: stats.totalCheckIns,
      ),
      Achievement(
        id: 'check_in_10',
        title: 'Chăm chỉ',
        description: 'Đạt 10 check-in đã được xác minh.',
        icon: Icons.local_fire_department_rounded,
        target: 10,
        isStreakAchievement: false,
        progress: stats.totalCheckIns,
      ),
      Achievement(
        id: 'check_in_25',
        title: 'Không bỏ cuộc',
        description: 'Đạt 25 check-in đã được xác minh.',
        icon: Icons.workspace_premium_rounded,
        target: 25,
        isStreakAchievement: false,
        progress: stats.totalCheckIns,
      ),
      Achievement(
        id: 'check_in_50',
        title: 'Bậc thầy check-in',
        description: 'Đạt 50 check-in đã được xác minh.',
        icon: Icons.military_tech_rounded,
        target: 50,
        isStreakAchievement: false,
        progress: stats.totalCheckIns,
      ),
      Achievement(
        id: 'streak_3',
        title: 'Khởi động streak',
        description: 'Duy trì streak 3 ngày học liên tiếp.',
        icon: Icons.local_fire_department_rounded,
        target: 3,
        isStreakAchievement: true,
        progress: stats.longestStreak,
      ),
      Achievement(
        id: 'streak_7',
        title: 'Một tuần bền bỉ',
        description: 'Duy trì streak 7 ngày học liên tiếp.',
        icon: Icons.calendar_month_rounded,
        target: 7,
        isStreakAchievement: true,
        progress: stats.longestStreak,
      ),
      Achievement(
        id: 'streak_14',
        title: 'Hai tuần kỷ luật',
        description: 'Duy trì streak 14 ngày học liên tiếp.',
        icon: Icons.emoji_events_rounded,
        target: 14,
        isStreakAchievement: true,
        progress: stats.longestStreak,
      ),
    ];
  }

  Widget _buildAchievementCard(Achievement achievement) {
    final unlocked = achievement.unlocked;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      elevation: 0,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Container(
              width: 58,
              height: 58,
              decoration: BoxDecoration(
                color: unlocked
                    ? const Color(0xFFEAF4FF)
                    : Colors.grey.shade100,
                borderRadius: BorderRadius.circular(16),
              ),
              child: Icon(
                achievement.icon,
                size: 30,
                color: unlocked
                    ? const Color(0xFF005BAC)
                    : Colors.grey,
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          achievement.title,
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                            color: unlocked
                                ? Colors.black87
                                : Colors.black54,
                          ),
                        ),
                      ),
                      Icon(
                        unlocked
                            ? Icons.check_circle_rounded
                            : Icons.lock_outline_rounded,
                        size: 20,
                        color: unlocked
                            ? Colors.green
                            : Colors.grey,
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    achievement.description,
                    style: const TextStyle(
                      fontSize: 13,
                      color: Colors.black54,
                    ),
                  ),
                  const SizedBox(height: 10),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: LinearProgressIndicator(
                      value: achievement.progressRatio,
                      minHeight: 7,
                      backgroundColor: Colors.grey.shade200,
                      color: unlocked
                          ? Colors.green
                          : const Color(0xFF005BAC),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    achievement.progressText,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: unlocked
                          ? Colors.green.shade700
                          : Colors.black45,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final achievements = _buildAchievements();
    final unlockedCount = achievements.where((item) => item.unlocked).length;

    return Scaffold(
      backgroundColor: const Color(0xFFEAF4FF),
      appBar: AppBar(
        title: const Text('Thành tích'),
        backgroundColor: Colors.transparent,
      ),
      body: RefreshIndicator(
        onRefresh: _loadAchievements,
        child: isLoading
            ? ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  SizedBox(
                    height: 300,
                    child: Center(
                      child: CircularProgressIndicator(),
                    ),
                  ),
                ],
              )
            : errorMessage != null
                ? ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(24),
                    children: [
                      const SizedBox(height: 100),
                      const Icon(
                        Icons.error_outline,
                        size: 48,
                        color: Colors.red,
                      ),
                      const SizedBox(height: 16),
                      const Text(
                        'Không thể tải thành tích.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        errorMessage!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 12),
                      ),
                      const SizedBox(height: 16),
                      Center(
                        child: OutlinedButton(
                          onPressed: _loadAchievements,
                          child: const Text('Thử lại'),
                        ),
                      ),
                    ],
                  )
                : ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(16),
                    children: [
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          color: const Color(0xFF005BAC),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Row(
                          children: [
                            const Icon(
                              Icons.emoji_events_rounded,
                              color: Colors.white,
                              size: 42,
                            ),
                            const SizedBox(width: 14),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Text(
                                    'Tiến trình thành tích',
                                    style: TextStyle(
                                      color: Colors.white70,
                                      fontSize: 13,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    '$unlockedCount / ${achievements.length} đã mở khóa',
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 22,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    '${stats.totalCheckIns} check-in • '
                                    'streak dài nhất ${stats.longestStreak} ngày',
                                    style: const TextStyle(
                                      color: Colors.white70,
                                      fontSize: 12,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 18),
                      ...achievements.map(_buildAchievementCard),
                    ],
                  ),
      ),
    );
  }
}

// ============================================================
// LEADERBOARD
// ============================================================

class LeaderboardScreen extends StatefulWidget {
  const LeaderboardScreen({super.key});

  @override
  State<LeaderboardScreen> createState() =>
      _LeaderboardScreenState();
}

class _LeaderboardScreenState extends State<LeaderboardScreen> {
  bool isLoading = true;
  String? errorMessage;
  List<Map<String, dynamic>> leaderboard = [];

  @override
  void initState() {
    super.initState();
    _loadLeaderboard();
  }

  Future<void> _loadLeaderboard() async {
    try {
      setState(() {
        isLoading = true;
        errorMessage = null;
      });

      final data = await supabase.rpc('get_leaderboard');

      final rows = (data as List)
          .map((row) => Map<String, dynamic>.from(row as Map))
          .toList();

      rows.sort((a, b) {
        final streakCompare =
            ((b['current_streak'] as num?)?.toInt() ?? 0)
                .compareTo((a['current_streak'] as num?)?.toInt() ?? 0);

        if (streakCompare != 0) {
          return streakCompare;
        }

        final checkInCompare =
            ((b['total_check_ins'] as num?)?.toInt() ?? 0)
                .compareTo((a['total_check_ins'] as num?)?.toInt() ?? 0);

        if (checkInCompare != 0) {
          return checkInCompare;
        }

        return _displayName(a).toLowerCase().compareTo(
              _displayName(b).toLowerCase(),
            );
      });

      if (!mounted) return;

      setState(() {
        leaderboard = rows;
        isLoading = false;
      });
    } catch (e) {
      debugPrint('Load leaderboard error: $e');

      if (!mounted) return;

      setState(() {
        isLoading = false;
        errorMessage = e.toString();
      });
    }
  }

  String _displayName(Map<String, dynamic> row) {
    final value = row['display_name']?.toString().trim();
    return value == null || value.isEmpty ? 'Sinh viên' : value;
  }

  String? _avatarUrl(Map<String, dynamic> row) {
    final value = row['avatar_url']?.toString().trim();
    return value == null || value.isEmpty ? null : value;
  }

  String _studentCode(Map<String, dynamic> row) {
    final value = row['student_code']?.toString().trim();
    return value == null || value.isEmpty ? 'Chưa có MSSV' : value;
  }

  String _className(Map<String, dynamic> row) {
    final value = row['class_name']?.toString().trim();
    return value == null || value.isEmpty ? 'Chưa có lớp' : value;
  }

  int _streak(Map<String, dynamic> row) {
    return (row['current_streak'] as num?)?.toInt() ?? 0;
  }

  int _totalCheckIns(Map<String, dynamic> row) {
    return (row['total_check_ins'] as num?)?.toInt() ?? 0;
  }

  Widget _buildAvatar(Map<String, dynamic> row, {double radius = 24}) {
    final avatarUrl = _avatarUrl(row);

    return CircleAvatar(
      radius: radius,
      backgroundImage: avatarUrl != null
          ? NetworkImage(avatarUrl)
          : null,
      child: avatarUrl == null
          ? Icon(Icons.person, size: radius)
          : null,
    );
  }

  Widget _buildPodiumCard({
    required Map<String, dynamic> row,
    required int rank,
  }) {
    final streak = _streak(row);

    return Expanded(
      child: Container(
        margin: EdgeInsets.only(
          left: rank == 1 ? 6 : 4,
          right: rank == 3 ? 6 : 4,
          top: rank == 1 ? 0 : 28,
        ),
        padding: const EdgeInsets.symmetric(
          horizontal: 8,
          vertical: 14,
        ),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.06),
              blurRadius: 12,
              offset: const Offset(0, 5),
            ),
          ],
        ),
        child: Column(
          children: [
            Text(
              '#$rank',
              style: TextStyle(
                fontSize: rank == 1 ? 22 : 18,
                fontWeight: FontWeight.bold,
                color: const Color(0xFF005BAC),
              ),
            ),
            const SizedBox(height: 8),
            _buildAvatar(
              row,
              radius: rank == 1 ? 34 : 28,
            ),
            const SizedBox(height: 8),
            Text(
              _displayName(row),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              _className(row),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 10, color: Colors.black54),
            ),
            Text(
              _studentCode(row),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 10, color: Colors.black45),
            ),
            const SizedBox(height: 4),
            Text(
              '🔥 $streak ngày',
              style: const TextStyle(
                fontSize: 12,
                color: Colors.black54,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildRow(Map<String, dynamic> row, int index) {
    final rank = index + 1;
    final currentUserId = supabase.auth.currentUser?.id;
    final isMe = row['user_id']?.toString() == currentUserId;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      elevation: 0,
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 14,
          vertical: 4,
        ),
        leading: SizedBox(
          width: 42,
          child: Text(
            '#$rank',
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
        title: Row(
          children: [
            _buildAvatar(row, radius: 20),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                _displayName(row),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontWeight: isMe
                      ? FontWeight.bold
                      : FontWeight.w600,
                ),
              ),
            ),
            if (isMe)
              Container(
                margin: const EdgeInsets.only(left: 6),
                padding: const EdgeInsets.symmetric(
                  horizontal: 7,
                  vertical: 3,
                ),
                decoration: BoxDecoration(
                  color: const Color(0xFFEAF4FF),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Text(
                  'Bạn',
                  style: TextStyle(
                    fontSize: 10,
                    color: Color(0xFF005BAC),
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
          ],
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(left: 52, top: 3),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${_className(row)} • ${_studentCode(row)}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 12, color: Colors.black54),
              ),
              const SizedBox(height: 2),
              Text(
                '${_totalCheckIns(row)} check-in đã xác minh',
                style: const TextStyle(fontSize: 12),
              ),
            ],
          ),
        ),
        trailing: Text(
          '🔥 ${_streak(row)}',
          style: const TextStyle(
            fontWeight: FontWeight.bold,
            fontSize: 16,
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFEAF4FF),
      appBar: AppBar(
        title: const Text('Xếp hạng'),
        backgroundColor: Colors.transparent,
      ),
      body: RefreshIndicator(
        onRefresh: _loadLeaderboard,
        child: isLoading
            ? ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  SizedBox(
                    height: 300,
                    child: Center(
                      child: CircularProgressIndicator(),
                    ),
                  ),
                ],
              )
            : errorMessage != null
                ? ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(24),
                    children: [
                      const SizedBox(height: 100),
                      const Icon(
                        Icons.error_outline,
                        size: 48,
                        color: Colors.red,
                      ),
                      const SizedBox(height: 16),
                      const Text(
                        'Không thể tải bảng xếp hạng.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        errorMessage!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 12),
                      ),
                      const SizedBox(height: 16),
                      Center(
                        child: OutlinedButton(
                          onPressed: _loadLeaderboard,
                          child: const Text('Thử lại'),
                        ),
                      ),
                    ],
                  )
                : leaderboard.isEmpty
                    ? ListView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        children: const [
                          SizedBox(
                            height: 300,
                            child: Center(
                              child: Text('Chưa có dữ liệu xếp hạng.'),
                            ),
                          ),
                        ],
                      )
                    : ListView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.all(16),
                        children: [
                          const Text(
                            'Leaderboard',
                            style: TextStyle(
                              fontSize: 24,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(height: 4),
                          const Text(
                            'Xếp theo streak hiện tại',
                            style: TextStyle(
                              color: Colors.black54,
                              fontSize: 13,
                            ),
                          ),
                          const SizedBox(height: 18),
                          if (leaderboard.length >= 3)
                            Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                _buildPodiumCard(
                                  row: leaderboard[1],
                                  rank: 2,
                                ),
                                _buildPodiumCard(
                                  row: leaderboard[0],
                                  rank: 1,
                                ),
                                _buildPodiumCard(
                                  row: leaderboard[2],
                                  rank: 3,
                                ),
                              ],
                            ),
                          const SizedBox(height: 22),
                          ...List.generate(
                            leaderboard.length >= 3
                                ? leaderboard.length - 3
                                : leaderboard.length,
                            (i) => _buildRow(
                              leaderboard.length >= 3
                                  ? leaderboard[i + 3]
                                  : leaderboard[i],
                              leaderboard.length >= 3 ? i + 3 : i,
                            ),
                          ),
                        ],
                      ),
      ),
    );
  }
}

// ============================================================
// SCHEDULE IMPORT
// ============================================================

class ParsedScheduleMeeting {
  final int dayOfWeek;
  final int startPeriod;
  final int endPeriod;
  final String room;

  const ParsedScheduleMeeting({
    required this.dayOfWeek,
    required this.startPeriod,
    required this.endPeriod,
    required this.room,
  });
}

class ParsedScheduleCourse {
  final String subjectCode;
  final String subjectName;
  final String teacher;
  final List<ParsedScheduleMeeting> meetings;

  const ParsedScheduleCourse({
    required this.subjectCode,
    required this.subjectName,
    required this.teacher,
    required this.meetings,
  });
}

class ScheduleImportResult {
  final int courseCount;
  final int sessionCount;
  final int skippedLineCount;
  final List<String> warnings;

  const ScheduleImportResult({
    required this.courseCount,
    required this.sessionCount,
    required this.skippedLineCount,
    required this.warnings,
  });
}

final RegExp _subjectCodePattern = RegExp(
  r'^\d{7}\.\d+\.\d+\.\d+$',
);

final RegExp _schedulePattern = RegExp(
  r'(?:Thứ\s*[2-7]|Thứ\s*(?:Hai|Ba|Tư|Năm|Sáu|Bảy)|(?:CN|Chủ\s*Nhật))\s*,?\s*\d{1,2}\s*-\s*\d{1,2}\s*,',
  caseSensitive: false,
);

int? _parseDayToken(String token) {
  final normalized = token
      .trim()
      .toLowerCase()
      .replaceAll(RegExp(r'\s+'), ' ');

  if (normalized == 'cn' || normalized == 'chủ nhật') return 7;
  if (normalized.contains('thứ 2') || normalized == 'thứ hai') return 1;
  if (normalized.contains('thứ 3') || normalized == 'thứ ba') return 2;
  if (normalized.contains('thứ 4') || normalized == 'thứ tư') return 3;
  if (normalized.contains('thứ 5') || normalized == 'thứ năm') return 4;
  if (normalized.contains('thứ 6') || normalized == 'thứ sáu') return 5;
  if (normalized.contains('thứ 7') || normalized == 'thứ bảy') return 6;

  return null;
}

String _periodStartTime(int period) {
  const values = <int, String>{
    1: '07:00:00',
    2: '08:00:00',
    3: '09:00:00',
    4: '10:00:00',
    5: '11:00:00',
    6: '12:30:00',
    7: '13:30:00',
    8: '14:30:00',
    9: '15:30:00',
    10: '16:30:00',
    11: '17:30:00',
    12: '18:15:00',
    13: '19:10:00',
    14: '19:55:00',
  };

  final value = values[period];
  if (value == null) {
    throw FormatException('Tiết $period không hợp lệ.');
  }
  return value;
}

String _periodEndTime(int period) {
  const values = <int, String>{
    1: '07:50:00',
    2: '08:50:00',
    3: '09:50:00',
    4: '10:50:00',
    5: '11:50:00',
    6: '13:20:00',
    7: '14:20:00',
    8: '15:20:00',
    9: '16:20:00',
    10: '17:20:00',
    11: '18:15:00',
    12: '19:00:00',
    13: '19:50:00',
    14: '20:40:00',
  };

  final value = values[period];
  if (value == null) {
    throw FormatException('Tiết $period không hợp lệ.');
  }
  return value;
}

List<String> _splitImportedLine(String line) {
  final trimmed = line.trim();
  if (trimmed.contains('|')) {
    var cells = trimmed.split('|').map((e) => e.trim()).toList();
    while (cells.isNotEmpty && cells.first.isEmpty) {
      cells.removeAt(0);
    }
    while (cells.isNotEmpty && cells.last.isEmpty) {
      cells.removeLast();
    }
    return cells;
  }

  if (trimmed.contains('\t')) {
    return trimmed.split('\t').map((e) => e.trim()).toList();
  }

  return [trimmed];
}

bool _isTableSeparatorLine(String line) {
  final withoutPipes = line.replaceAll('|', '').trim();
  if (withoutPipes.isEmpty) return true;
  return RegExp(r'^[:\-\s]+$').hasMatch(withoutPipes);
}

String _cleanImportedCell(String value) {
  return value
      .replaceAll(RegExp(r'<br\s*/?>', caseSensitive: false), ' ')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
}

List<ParsedScheduleMeeting> _parseScheduleCell(String scheduleCell) {
  final meetings = <ParsedScheduleMeeting>[];
  final segments = scheduleCell
      .split(RegExp(r'\s*;\s*'))
      .map(_cleanImportedCell)
      .where((e) => e.isNotEmpty);

  for (final segment in segments) {
    final match = RegExp(
      r'^(Thứ\s*(?:[2-7]|Hai|Ba|Tư|Năm|Sáu|Bảy)|CN|Chủ\s*Nhật)\s*,\s*(\d{1,2})\s*-\s*(\d{1,2})\s*,\s*(.+)$',
      caseSensitive: false,
    ).firstMatch(segment);

    if (match == null) {
      throw FormatException('Không đọc được lịch học: "$segment"');
    }

    final day = _parseDayToken(match.group(1)!);
    final startPeriod = int.tryParse(match.group(2)!);
    final endPeriod = int.tryParse(match.group(3)!);
    final room = _cleanImportedCell(match.group(4)!);

    if (day == null || startPeriod == null || endPeriod == null) {
      throw FormatException('Không đọc được thứ/tiết: "$segment"');
    }
    if (startPeriod < 1 || endPeriod > 14 || startPeriod > endPeriod) {
      throw FormatException('Khoảng tiết không hợp lệ: "$segment"');
    }
    if (room.isEmpty) {
      throw FormatException('Thiếu phòng học: "$segment"');
    }

    meetings.add(
      ParsedScheduleMeeting(
        dayOfWeek: day,
        startPeriod: startPeriod,
        endPeriod: endPeriod,
        room: room,
      ),
    );
  }

  return meetings;
}

List<ParsedScheduleCourse> _parsePastedSchedule(String text) {
  final courses = <ParsedScheduleCourse>[];
  final lines = text.replaceAll('\r\n', '\n').split('\n');

  for (final rawLine in lines) {
    final line = rawLine.trim();
    if (line.isEmpty || _isTableSeparatorLine(line)) continue;

    final cells = _splitImportedLine(line);
    if (cells.isEmpty) continue;

    int codeIndex = -1;
    for (var i = 0; i < cells.length; i++) {
      final cell = _cleanImportedCell(cells[i]);
      if (_subjectCodePattern.hasMatch(cell)) {
        codeIndex = i;
        break;
      }
    }

    if (codeIndex < 0) continue;

    int scheduleIndex = -1;
    for (var i = codeIndex + 1; i < cells.length; i++) {
      if (_schedulePattern.hasMatch(_cleanImportedCell(cells[i]))) {
        scheduleIndex = i;
        break;
      }
    }

    if (scheduleIndex < 0) {
      throw FormatException(
        'Không tìm thấy cột lịch học cho mã ${cells[codeIndex]}.',
      );
    }

    final subjectCode = _cleanImportedCell(cells[codeIndex]);
    final beforeSchedule = <String>[];
    for (var i = codeIndex + 1; i < scheduleIndex; i++) {
      final value = _cleanImportedCell(cells[i]);
      if (value.isEmpty) continue;
      if (RegExp(r'^\d+(?:[.,]\d+)?$').hasMatch(value)) continue;
      beforeSchedule.add(value);
    }

    if (beforeSchedule.isEmpty) {
      throw FormatException(
        'Không tìm thấy tên môn cho mã $subjectCode.',
      );
    }

    // Trang sinh viên có một số dòng đặc biệt như GDTC:
    // mã môn -> mã lớp (B26-GDTC1-17) -> tín chỉ -> ... -> tên đơn vị.
    // Với các dòng bình thường, phần tử đầu tiên sau mã môn là tên môn.
    String subjectName = beforeSchedule.first;
    if (RegExp(r'^[A-Z]\d{2}-.+', caseSensitive: false)
        .hasMatch(subjectName) &&
        beforeSchedule.length >= 2) {
      subjectName = beforeSchedule.last;
    }

    // Giáo viên thường là ô ngay trước ô lịch. Nếu ô đó chính là
    // tên môn/đơn vị thì để trống (trường hợp GDTC trong dữ liệu mẫu).
    final teacherCandidate = beforeSchedule.last;
    final teacher = teacherCandidate == subjectName
        ? ''
        : teacherCandidate;

    final meetings = _parseScheduleCell(
      _cleanImportedCell(cells[scheduleIndex]),
    );

    courses.add(
      ParsedScheduleCourse(
        subjectCode: subjectCode,
        subjectName: subjectName,
        teacher: teacher,
        meetings: meetings,
      ),
    );
  }

  if (courses.isEmpty) {
    throw const FormatException(
      'Không tìm thấy dòng lịch học hợp lệ. Hãy copy nguyên bảng lịch học từ trang sinh viên.',
    );
  }

  return courses;
}

// ============================================================
// SCHEDULE
// ============================================================

class ScheduleScreen extends StatefulWidget {
  const ScheduleScreen({super.key});

  @override
  State<ScheduleScreen> createState() =>
      _ScheduleScreenState();
}

class _ScheduleScreenState
    extends State<ScheduleScreen> {
  List<ClassSession> classes = [];

  bool isLoading = true;

  String? errorMessage;

  @override
  void initState() {
    super.initState();
    _loadClasses();
  }

  // ==========================================================
  // LOAD ALL CLASSES
  // ==========================================================

  Future<void> _loadClasses() async {
    try {
      setState(() {
        isLoading = true;
        errorMessage = null;
      });

      final user = supabase.auth.currentUser;

      if (user == null) {
        throw Exception('Chưa đăng nhập.');
      }

      final data = await supabase
          .from('class_sessions')
          .select('''
            id,
            room,
            start_time,
            end_time,
            teacher,
            day_of_week,
            is_active,
            subjects (
              name,
              subject_code,
              teacher
            )
          ''')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .order('day_of_week')
          .order('start_time');

      final loadedClasses = (data as List)
          .map(
            (item) => ClassSession.fromMap(
              Map<String, dynamic>.from(item),
            ),
          )
          .toList();

      // Mỗi lần mở/làm mới trang Lịch học, đồng bộ lại toàn bộ
      // thông báo của tuần để lịch mới thêm/sửa/xóa được cập nhật ngay.
      await NotificationService.syncSchedule(loadedClasses);

      if (!mounted) return;

      setState(() {
        classes = loadedClasses;
        isLoading = false;
      });

      debugPrint(
        'Loaded total classes: '
        '${loadedClasses.length}',
      );
    } catch (e) {
      if (!mounted) return;

      setState(() {
        isLoading = false;
        errorMessage = e.toString();
      });

      debugPrint(
        'Load schedule error: $e',
      );
    }
  }

  // ==========================================================
  // DAY NAME
  // ==========================================================

  String _dayName(int day) {
    switch (day) {
      case 1:
        return 'Thứ Hai';

      case 2:
        return 'Thứ Ba';

      case 3:
        return 'Thứ Tư';

      case 4:
        return 'Thứ Năm';

      case 5:
        return 'Thứ Sáu';

      case 6:
        return 'Thứ Bảy';

      case 7:
        return 'Chủ Nhật';

      default:
        return 'Không xác định';
    }
  }

  // ==========================================================
  // IMPORT SCHEDULE FROM STUDENT PORTAL
  // ==========================================================

  Future<ScheduleImportResult> _importScheduleText(String text) async {
    final user = supabase.auth.currentUser;
    if (user == null) {
      throw Exception('Chưa đăng nhập.');
    }

    final courses = _parsePastedSchedule(text);
    var insertedSessions = 0;
    var skippedSessions = 0;
    final warnings = <String>[];

    for (final course in courses) {
      Map<String, dynamic>? subject;

      final existingSubjects = await supabase
          .from('subjects')
          .select('id, name, teacher')
          .eq('user_id', user.id)
          .eq('subject_code', course.subjectCode)
          .limit(1);

      if (existingSubjects.isNotEmpty) {
        subject = Map<String, dynamic>.from(existingSubjects.first);
      } else {
        final insertedSubject = await supabase
            .from('subjects')
            .insert({
              'user_id': user.id,
              'subject_code': course.subjectCode,
              'name': course.subjectName,
              'teacher': course.teacher.isEmpty ? null : course.teacher,
            })
            .select('id, name, teacher')
            .single();

        subject = Map<String, dynamic>.from(insertedSubject);
      }

      final subjectId = subject['id']?.toString();
      if (subjectId == null || subjectId.isEmpty) {
        throw Exception(
          'Không lấy được ID môn ${course.subjectName}.',
        );
      }

      for (final meeting in course.meetings) {
        final startTime = _periodStartTime(meeting.startPeriod);
        final endTime = _periodEndTime(meeting.endPeriod);

        final existingSessions = await supabase
            .from('class_sessions')
            .select('id, is_active')
            .eq('user_id', user.id)
            .eq('subject_id', subjectId)
            .eq('day_of_week', meeting.dayOfWeek)
            .eq('room', meeting.room)
            .eq('start_time', startTime)
            .eq('end_time', endTime)
            .limit(1);

        if (existingSessions.isNotEmpty) {
          final existing = Map<String, dynamic>.from(existingSessions.first);
          if (existing['is_active'] == false) {
            // Re-activate a previously soft-deleted session instead of
            // creating a new class_session_id and losing its history link.
            await supabase
                .from('class_sessions')
                .update({'is_active': true})
                .eq('id', existing['id'])
                .eq('user_id', user.id);
            insertedSessions++;
          } else {
            skippedSessions++;
          }
          continue;
        }

        await supabase.from('class_sessions').insert({
          'user_id': user.id,
          'subject_id': subjectId,
          'room': meeting.room,
          'start_time': startTime,
          'end_time': endTime,
          'teacher': course.teacher.isEmpty ? null : course.teacher,
          'day_of_week': meeting.dayOfWeek,
        });

        insertedSessions++;
      }
    }

    if (skippedSessions > 0) {
      warnings.add(
        '$skippedSessions buổi đã có sẵn nên được bỏ qua, không tạo trùng.',
      );
    }

    return ScheduleImportResult(
      courseCount: courses.length,
      sessionCount: insertedSessions,
      skippedLineCount: 0,
      warnings: warnings,
    );
  }

  Future<void> _showImportScheduleDialog() async {
    final controller = TextEditingController();
    bool importing = false;
    String? dialogError;

    final result = await showDialog<ScheduleImportResult>(
      context: context,
      barrierDismissible: !importing,
      builder: (dialogContext) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            Future<void> submit() async {
              final text = controller.text.trim();
              if (text.isEmpty) {
                setDialogState(() {
                  dialogError = 'Hãy dán bảng lịch học vào ô bên trên.';
                });
                return;
              }

              setDialogState(() {
                importing = true;
                dialogError = null;
              });

              try {
                final importResult = await _importScheduleText(text);
                if (!mounted) return;
                FocusManager.instance.primaryFocus?.unfocus();
                Navigator.of(dialogContext).pop(importResult);
              } catch (e) {
                debugPrint('Import schedule error: $e');
                setDialogState(() {
                  importing = false;
                  dialogError = e is FormatException
                      ? e.message
                      : 'Không thể thêm lịch học: $e';
                });
              }
            }

            return AlertDialog(
              title: const Text('Thêm lịch học'),
              content: SizedBox(
                width: 600,
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Text(
                        'Copy nguyên bảng lịch học từ trang sinh viên rồi dán vào đây. App sẽ tự nhận diện mã môn, thứ, tiết, phòng và giảng viên.',
                        style: TextStyle(color: Colors.black54),
                      ),
                      const SizedBox(height: 14),
                      TextField(
                        controller: controller,
                        enabled: !importing,
                        minLines: 10,
                        maxLines: 18,
                        keyboardType: TextInputType.multiline,
                        decoration: InputDecoration(
                          hintText:
                              'Dán bảng lịch học vào đây...\n\nVí dụ: 3190320.2610.26.10 | Giải tích | ... | Trần Chín | Thứ 3,1-3,F106; Thứ 5,6-8,H106 | ...',
                          alignLabelWithHint: true,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                        ),
                      ),
                      if (dialogError != null) ...[
                        const SizedBox(height: 12),
                        Text(
                          dialogError!,
                          style: const TextStyle(
                            color: Colors.red,
                            fontSize: 13,
                          ),
                        ),
                      ],
                      const SizedBox(height: 10),
                      const Text(
                        'Lưu ý: dữ liệu hiện tại chưa lưu tuần học (ví dụ 4-8;13-14;16-20) trong class_sessions. Phần tuần sẽ được bỏ qua khi import.',
                        style: TextStyle(
                          color: Colors.black45,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              actions: [
                TextButton(
                  onPressed: importing
                      ? null
                      : () {
                          FocusManager.instance.primaryFocus?.unfocus();
                          Navigator.of(dialogContext).pop();
                        },
                  child: const Text('Hủy'),
                ),
                FilledButton.icon(
                  onPressed: importing ? null : submit,
                  icon: importing
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.download_rounded),
                  label: Text(importing ? 'Đang thêm...' : 'Thêm lịch'),
                ),
              ],
            );
          },
        );
      },
    );

    // Let the dialog/focus tree finish deactivating before disposing the controller.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      controller.dispose();
    });

    if (result == null || !mounted) return;

    await _loadClasses();

    if (!mounted) return;

    final warning = result.warnings.isEmpty
        ? ''
        : ' ${result.warnings.join(' ')}';

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          'Đã xử lý ${result.courseCount} môn, thêm ${result.sessionCount} buổi học.$warning',
        ),
        duration: const Duration(seconds: 4),
      ),
    );
  }

  String _periodLabel(int period) {
    return 'Tiết $period (${_periodStartTime(period).substring(0, 5)}–${_periodEndTime(period).substring(0, 5)})';
  }

  int? _periodFromTime(String time) {
    final normalized = time.length >= 5 ? time.substring(0, 5) : time;
    for (int i = 1; i <= 14; i++) {
      if (_periodStartTime(i).substring(0, 5) == normalized) return i;
    }
    return null;
  }

  int? _periodFromEndTime(String time) {
    final normalized = time.length >= 5 ? time.substring(0, 5) : time;
    for (int i = 1; i <= 14; i++) {
      if (_periodEndTime(i).substring(0, 5) == normalized) return i;
    }
    return null;
  }

  Future<Map<String, dynamic>?> _loadSubjectForClass(ClassSession classSession) async {
    final data = await supabase
        .from('class_sessions')
        .select('subject_id, subjects(id, name, subject_code, teacher)')
        .eq('id', classSession.id)
        .single();
    final row = Map<String, dynamic>.from(data);
    final raw = row['subjects'];
    if (raw is Map) {
      return Map<String, dynamic>.from(raw)..['id'] = row['subject_id']?.toString();
    }
    return null;
  }

  Future<String> _findOrCreateSubject({
    required String subjectName,
    required String subjectCode,
    required String teacher,
    String? existingSubjectId,
  }) async {
    final user = supabase.auth.currentUser;
    if (user == null) throw Exception('Chưa đăng nhập.');

    if (existingSubjectId != null && existingSubjectId.isNotEmpty) {
      await supabase.from('subjects').update({
        'name': subjectName,
        'subject_code': subjectCode.isEmpty ? null : subjectCode,
        'teacher': teacher.isEmpty ? null : teacher,
      }).eq('id', existingSubjectId).eq('user_id', user.id);
      return existingSubjectId;
    }

    final existing = await supabase
        .from('subjects')
        .select('id')
        .eq('user_id', user.id)
        .eq('name', subjectName)
        .limit(1);

    if (existing.isNotEmpty) {
      final id = existing.first['id'].toString();
      await supabase.from('subjects').update({
        'subject_code': subjectCode.isEmpty ? null : subjectCode,
        'teacher': teacher.isEmpty ? null : teacher,
      }).eq('id', id).eq('user_id', user.id);
      return id;
    }

    final inserted = await supabase.from('subjects').insert({
      'user_id': user.id,
      'subject_code': subjectCode.isEmpty ? null : subjectCode,
      'name': subjectName,
      'teacher': teacher.isEmpty ? null : teacher,
    }).select('id').single();
    return inserted['id'].toString();
  }

  Future<void> _showScheduleForm({ClassSession? editing}) async {
    final isEditing = editing != null;
    String? subjectId;
    String? error;
    bool saving = false;

    final name = TextEditingController(text: editing?.subject ?? '');
    final code = TextEditingController();
    final teacher = TextEditingController(text: editing?.teacher ?? '');
    final room = TextEditingController(text: editing?.room ?? '');

    int day = editing?.dayOfWeek ?? DateTime.now().weekday;
    final parsedStartPeriod =
        _periodFromTime(editing?.startTime ?? '');
    final parsedEndPeriod =
        _periodFromEndTime(editing?.endTime ?? '');
    int startPeriod = parsedStartPeriod ?? 1;
    int endPeriod = parsedEndPeriod ?? startPeriod;

    if (editing != null) {
      try {
        final subject = await _loadSubjectForClass(editing);
        if (subject != null) {
          subjectId = subject['id']?.toString();
          code.text = subject['subject_code']?.toString() ?? '';
          if (teacher.text.trim().isEmpty) {
            teacher.text = subject['teacher']?.toString() ?? '';
          }
        }
      } catch (e) {
        debugPrint('Load subject for edit error: $e');
      }
    }

    if (!mounted) return;

    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) {
          Future<void> save() async {
            final subjectName = name.text.trim();
            final subjectCode = code.text.trim();
            final subjectTeacher = teacher.text.trim();
            final subjectRoom = room.text.trim();

            if (subjectName.isEmpty) {
              setDialogState(() => error = 'Vui lòng nhập tên môn học.');
              return;
            }
            if (subjectRoom.isEmpty) {
              setDialogState(() => error = 'Vui lòng nhập phòng học.');
              return;
            }
            if (startPeriod > endPeriod) {
              setDialogState(() => error = 'Tiết bắt đầu phải nhỏ hơn hoặc bằng tiết kết thúc.');
              return;
            }

            setDialogState(() { saving = true; error = null; });
            try {
              final user = supabase.auth.currentUser;
              if (user == null) throw Exception('Chưa đăng nhập.');

              final sid = await _findOrCreateSubject(
                subjectName: subjectName,
                subjectCode: subjectCode,
                teacher: subjectTeacher,
                existingSubjectId: subjectId,
              );

              final startTime = _periodStartTime(startPeriod);
              final endTime = _periodEndTime(endPeriod);
              var reactivatedExisting = false;
              var duplicateQuery = supabase
                  .from('class_sessions')
                  .select('id, is_active')
                  .eq('user_id', user.id)
                  .eq('subject_id', sid)
                  .eq('day_of_week', day)
                  .eq('room', subjectRoom)
                  .eq('start_time', startTime)
                  .eq('end_time', endTime);
              if (editing != null) duplicateQuery = duplicateQuery.neq('id', editing.id);

              final duplicate = await duplicateQuery.limit(1);
              if (duplicate.isNotEmpty) {
                final duplicateRow = Map<String, dynamic>.from(duplicate.first);
                if (duplicateRow['is_active'] == false) {
                  reactivatedExisting = true;
                  await supabase
                      .from('class_sessions')
                      .update({
                        'subject_id': sid,
                        'room': subjectRoom,
                        'start_time': startTime,
                        'end_time': endTime,
                        'teacher': subjectTeacher.isEmpty ? null : subjectTeacher,
                        'day_of_week': day,
                        'is_active': true,
                      })
                      .eq('id', duplicateRow['id'])
                      .eq('user_id', user.id);
                } else {
                  throw Exception('Lịch học này đã tồn tại.');
                }
              }

              final payload = {
                'subject_id': sid,
                'room': subjectRoom,
                'start_time': startTime,
                'end_time': endTime,
                'teacher': subjectTeacher.isEmpty ? null : subjectTeacher,
                'day_of_week': day,
              };

              if (editing != null) {
                await supabase.from('class_sessions').update({
                  ...payload,
                  'is_active': true,
                }).eq('id', editing.id).eq('user_id', user.id);
              } else if (!reactivatedExisting) {
                await supabase.from('class_sessions').insert({
                  'user_id': user.id,
                  ...payload,
                  'is_active': true,
                });
              }

              if (dialogContext.mounted) {
                FocusManager.instance.primaryFocus?.unfocus();
                Navigator.of(dialogContext).pop(true);
              }
            } catch (e) {
              setDialogState(() {
                saving = false;
                error = 'Không thể ${isEditing ? 'cập nhật' : 'thêm'} lịch học: $e';
              });
            }
          }

          return AlertDialog(
            title: Text(isEditing ? 'Chỉnh sửa lịch học' : 'Thêm lịch học thủ công'),
            content: SizedBox(
              width: 520,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    TextField(controller: name, decoration: const InputDecoration(labelText: 'Tên môn học *', prefixIcon: Icon(Icons.book_outlined))),
                    const SizedBox(height: 12),
                    TextField(controller: code, decoration: const InputDecoration(labelText: 'Mã môn học', prefixIcon: Icon(Icons.tag_rounded))),
                    const SizedBox(height: 12),
                    TextField(controller: teacher, decoration: const InputDecoration(labelText: 'Giảng viên', prefixIcon: Icon(Icons.person_outline))),
                    const SizedBox(height: 12),
                    TextField(controller: room, decoration: const InputDecoration(labelText: 'Phòng học *', prefixIcon: Icon(Icons.location_on_outlined))),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<int>(
                      value: day,
                      decoration: const InputDecoration(labelText: 'Thứ', prefixIcon: Icon(Icons.calendar_today_outlined)),
                      items: List.generate(7, (i) => DropdownMenuItem(value: i + 1, child: Text(_dayName(i + 1)))),
                      onChanged: saving ? null : (v) { if (v != null) setDialogState(() => day = v); },
                    ),
                    const SizedBox(height: 12),
                    Row(children: [
                      Expanded(child: DropdownButtonFormField<int>(
                        value: startPeriod,
                        isExpanded: true,
                        decoration: const InputDecoration(labelText: 'Tiết bắt đầu'),
                        items: List.generate(14, (i) => DropdownMenuItem(value: i + 1, child: Text('Tiết ${i + 1}'))),
                        onChanged: saving ? null : (v) { if (v != null) setDialogState(() { startPeriod = v; if (endPeriod < v) endPeriod = v; }); },
                      )),
                      const SizedBox(width: 12),
                      Expanded(child: DropdownButtonFormField<int>(
                        value: endPeriod,
                        isExpanded: true,
                        decoration: const InputDecoration(labelText: 'Tiết kết thúc'),
                        items: List.generate(14, (i) => DropdownMenuItem(value: i + 1, child: Text('Tiết ${i + 1}'))),
                        onChanged: saving ? null : (v) { if (v != null) setDialogState(() => endPeriod = v); },
                      )),
                    ]),
                    if (error != null) ...[
                      const SizedBox(height: 12),
                      Align(alignment: Alignment.centerLeft, child: Text(error!, style: const TextStyle(color: Colors.red, fontSize: 13))),
                    ],
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: saving
                    ? null
                    : () {
                        FocusManager.instance.primaryFocus?.unfocus();
                        Navigator.of(dialogContext).pop(false);
                      },
                child: const Text('Hủy'),
              ),
              FilledButton.icon(
                onPressed: saving ? null : save,
                icon: saving ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.save_outlined),
                label: Text(isEditing ? 'Lưu thay đổi' : 'Thêm lịch'),
              ),
            ],
          );
        },
      ),
    );

    WidgetsBinding.instance.addPostFrameCallback((_) {
      name.dispose();
      code.dispose();
      teacher.dispose();
      room.dispose();
    });

    if (saved == true && mounted) {
      await _loadClasses();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(isEditing ? 'Đã cập nhật lịch học.' : 'Đã thêm lịch học.')));
    }
  }

  Future<void> _showScheduleActions(ClassSession classSession) async {
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const CircleAvatar(
                backgroundColor: Color(0xFFEAF4FF),
                child: Icon(Icons.edit_outlined, color: Color(0xFF005BAC)),
              ),
              title: const Text('Chỉnh sửa'),
              subtitle: const Text('Thay đổi thông tin tiết học'),
              onTap: () {
                Navigator.of(sheetContext).pop();
                _showScheduleForm(editing: classSession);
              },
            ),
            ListTile(
              leading: const CircleAvatar(
                backgroundColor: Color(0xFFFFEEEE),
                child: Icon(Icons.delete_outline, color: Colors.red),
              ),
              title: const Text('Xóa'),
              subtitle: const Text('Xóa tiết học này khỏi lịch'),
              onTap: () {
                Navigator.of(sheetContext).pop();
                _deleteClass(classSession);
              },
            ),
            const SizedBox(height: 12),
          ],
        ),
      ),
    );
  }

  Future<void> _deleteClass(ClassSession classSession) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Xóa lịch học?'),
        content: Text(
          'Lịch "${classSession.subject}" vào ${_dayName(classSession.dayOfWeek)} (${classSession.time}) sẽ được ẩn khỏi lịch học. Nếu đã có check-in, lịch sử check-in vẫn được giữ lại.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('Hủy')),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: Colors.red), onPressed: () => Navigator.of(dialogContext).pop(true), child: const Text('Xóa')),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    try {
      final user = supabase.auth.currentUser;
      if (user == null) throw Exception('Chưa đăng nhập.');
      await supabase
          .from('class_sessions')
          .update({'is_active': false})
          .eq('id', classSession.id)
          .eq('user_id', user.id);
      await _loadClasses();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Đã xóa lịch học. Lịch sử check-in vẫn được giữ lại.')),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Không thể xóa lịch học.\n$e'), duration: const Duration(seconds: 5)),
      );
    }
  }

  Future<void> _showAddMenu() async {
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(
            leading: const CircleAvatar(backgroundColor: Color(0xFFEAF4FF), child: Icon(Icons.edit_calendar_rounded, color: Color(0xFF005BAC))),
            title: const Text('Thêm lịch thủ công'),
            subtitle: const Text('Tự nhập môn, thứ, tiết, phòng, giảng viên'),
            onTap: () { Navigator.of(sheetContext).pop(); _showScheduleForm(); },
          ),
          ListTile(
            leading: const CircleAvatar(backgroundColor: Color(0xFFEAF4FF), child: Icon(Icons.content_paste_rounded, color: Color(0xFF005BAC))),
            title: const Text('Nhập từ bảng lịch DUT'),
            subtitle: const Text('Dán nguyên bảng lịch học từ cổng sinh viên'),
            onTap: () { Navigator.of(sheetContext).pop(); _showImportScheduleDialog(); },
          ),
          const SizedBox(height: 12),
        ]),
      ),
    );
  }

  // ==========================================================
  // BUILD DAY SECTION
  // ==========================================================

  int _timeToMinutes(String value) {
    final parts = value.split(':');
    final hour = int.tryParse(parts.isNotEmpty ? parts[0] : '') ?? 0;
    final minute = int.tryParse(parts.length > 1 ? parts[1] : '') ?? 0;
    return hour * 60 + minute;
  }

  List<int> _orderedDaysFromToday() {
    final today = DateTime.now().weekday;
    return List<int>.generate(7, (index) => ((today - 1 + index) % 7) + 1);
  }

  Widget _buildDaySection(int day) {
    final dayClasses = classes
        .where(
          (item) =>
              item.dayOfWeek == day,
        )
        .toList()
      ..sort((a, b) => _timeToMinutes(a.startTime)
          .compareTo(_timeToMinutes(b.startTime)));

    if (dayClasses.isEmpty) {
      return const SizedBox.shrink();
    }

    return Column(
      crossAxisAlignment:
          CrossAxisAlignment.start,

      children: [
        Text(
          _dayName(day),
          style:
              const TextStyle(
            fontSize: 22,
            fontWeight:
                FontWeight.bold,
          ),
        ),

        const SizedBox(height: 16),

        ...dayClasses.map(
          (classSession) => Padding(
            padding:
                const EdgeInsets.only(
              bottom: 14,
            ),
            child: ScheduleCard(
              classSession: classSession,
              onTap: () => _showScheduleActions(classSession),
            ),
          ),
        ),

        const SizedBox(height: 12),
      ],
    );
  }

  // ==========================================================
  // BUILD
  // ==========================================================

  @override
  Widget build(BuildContext context) {
    if (isLoading) {
      return Scaffold(
        backgroundColor:
            const Color(0xFFEAF4FF),

        appBar: AppBar(
          title:
              const Text('Lịch học'),
          backgroundColor:
              Colors.transparent,
        ),

        body: const Center(
          child:
              CircularProgressIndicator(),
        ),
      );
    }

    if (errorMessage != null) {
      return Scaffold(
        backgroundColor:
            const Color(0xFFEAF4FF),

        appBar: AppBar(
          title:
              const Text('Lịch học'),
          backgroundColor:
              Colors.transparent,
        ),

        body: Center(
          child: Padding(
            padding:
                const EdgeInsets.all(24),

            child: Column(
              mainAxisSize:
                  MainAxisSize.min,

              children: [
                const Icon(
                  Icons.error_outline,
                  color: Colors.red,
                  size: 48,
                ),

                const SizedBox(height: 16),

                const Text(
                  'Không thể tải lịch học.',
                  style:
                      TextStyle(
                    fontSize: 18,
                    fontWeight:
                        FontWeight.bold,
                  ),
                ),

                const SizedBox(height: 10),

                Text(
                  errorMessage!,
                  textAlign:
                      TextAlign.center,
                ),

                const SizedBox(height: 20),

                ElevatedButton(
                  onPressed:
                      _loadClasses,
                  child:
                      const Text(
                    'Thử lại',
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Scaffold(
      backgroundColor:
          const Color(0xFFEAF4FF),

      appBar: AppBar(
        title: const Text(
          'Lịch học',
          style: TextStyle(
            fontWeight:
                FontWeight.bold,
          ),
        ),
        backgroundColor:
            Colors.transparent,
        actions: [
          IconButton(
            tooltip: 'Thêm lịch học',
            onPressed: _showAddMenu,
            icon: const Icon(Icons.add_circle_outline),
          ),
        ],
      ),

      body: classes.isEmpty
          ? const Center(
              child: Text(
                'Chưa có lịch học.',
              ),
            )
          : RefreshIndicator(
              onRefresh: _loadClasses,

              child: ListView(
                padding:
                    const EdgeInsets.all(20),

                children: [
                  for (final day in _orderedDaysFromToday())
                    _buildDaySection(day),

                  Container(
                    padding:
                        const EdgeInsets.all(18),

                    decoration:
                        BoxDecoration(
                      color: Colors.white,
                      borderRadius:
                          BorderRadius.circular(
                        20,
                      ),
                    ),

                    child: const Row(
                      children: [
                        Icon(
                          Icons.info_outline,
                          color:
                              Color(0xFF005BAC),
                        ),

                        SizedBox(width: 12),

                        Expanded(
                          child: Text(
                            'Mỗi lớp học sẽ tự động tạo một nhiệm vụ check-in.',
                            style:
                                TextStyle(
                              color:
                                  Colors.black54,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

// ============================================================
// MISSION CARD
// ============================================================

class MissionCard extends StatelessWidget {
  final ClassSession classSession;

  const MissionCard({
    super.key,
    required this.classSession,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius:
          BorderRadius.circular(20),

      onTap: () {
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) =>
                MissionScreen(
              classSession:
                  classSession,
            ),
          ),
        );
      },

      child: Container(
        padding:
            const EdgeInsets.all(18),

        decoration:
            BoxDecoration(
          color: Colors.white,
          borderRadius:
              BorderRadius.circular(20),
        ),

        child: Row(
          children: [
            Container(
              width: 52,
              height: 52,

              decoration:
                  BoxDecoration(
                color:
                    const Color(0xFFEAF4FF),
                borderRadius:
                    BorderRadius.circular(15),
              ),

              child: const Icon(
                Icons.camera_alt,
                color:
                    Color(0xFF005BAC),
              ),
            ),

            const SizedBox(width: 14),

            Expanded(
              child: Column(
                crossAxisAlignment:
                    CrossAxisAlignment.start,

                children: [
                  Text(
                    classSession.subject,
                    style:
                        const TextStyle(
                      fontSize: 16,
                      fontWeight:
                          FontWeight.bold,
                    ),
                  ),

                  const SizedBox(height: 5),

                  Text(
                    '${classSession.time} • '
                    '${classSession.room}',
                    style:
                        const TextStyle(
                      color:
                          Colors.black54,
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ),

            const Icon(
              Icons.arrow_forward_ios_rounded,
              size: 20,
              color:
                  Color(0xFF005BAC),
            ),
          ],
        ),
      ),
    );
  }
}

// ============================================================
// SCHEDULE CARD
// ============================================================

class ScheduleCard extends StatelessWidget {
  final ClassSession classSession;
  final VoidCallback? onTap;

  const ScheduleCard({
    super.key,
    required this.classSession,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20)),
        child: Row(
        children: [
          Container(
            width: 60,
            padding: const EdgeInsets.symmetric(vertical: 10),
            decoration: BoxDecoration(color: const Color(0xFFEAF4FF), borderRadius: BorderRadius.circular(14)),
            child: Column(children: [
              const Icon(Icons.access_time, color: Color(0xFF005BAC)),
              const SizedBox(height: 4),
              Text(_formatTimeHHmm(classSession.startTime), style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
            ]),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(child: Text(classSession.subject, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold))),
                if (classSession.isCheckInExcluded)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(color: Colors.black.withOpacity(0.06), borderRadius: BorderRadius.circular(10)),
                    child: const Text('Không Check-in', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: Colors.black54)),
                  ),
              ]),
              const SizedBox(height: 6),
              Text(classSession.time, style: const TextStyle(color: Colors.black54)),
              const SizedBox(height: 4),
              Text('Phòng ${classSession.room}', style: const TextStyle(color: Colors.black54)),
              if (classSession.teacher.trim().isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(classSession.teacher, style: const TextStyle(color: Colors.black45, fontSize: 13)),
              ],
            ]),
          ),
        ],
      ),
    ),
    );
  }
}

// ============================================================
// MISSION SCREEN
// ============================================================

class MissionScreen extends StatelessWidget {
  final ClassSession classSession;

  const MissionScreen({
    super.key,
    required this.classSession,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor:
          const Color(0xFFEAF4FF),

      appBar: AppBar(
        title:
            const Text('Nhiệm vụ'),
        backgroundColor:
            Colors.transparent,
      ),

      body: Padding(
        padding:
            const EdgeInsets.all(20),

        child: Column(
          crossAxisAlignment:
              CrossAxisAlignment.start,

          children: [
            Container(
              width: double.infinity,
              padding:
                  const EdgeInsets.all(24),

              decoration:
                  BoxDecoration(
                color: Colors.white,
                borderRadius:
                    BorderRadius.circular(24),
              ),

              child: Column(
                children: [
                  Container(
                    width: 80,
                    height: 80,

                    decoration:
                        BoxDecoration(
                      color:
                          const Color(0xFFEAF4FF),
                      borderRadius:
                          BorderRadius.circular(24),
                    ),

                    child: const Icon(
                      Icons.camera_alt_rounded,
                      size: 42,
                      color:
                          Color(0xFF005BAC),
                    ),
                  ),

                  const SizedBox(height: 20),

                  Text(
                    classSession.subject,
                    textAlign:
                        TextAlign.center,

                    style:
                        const TextStyle(
                      fontSize: 24,
                      fontWeight:
                          FontWeight.bold,
                    ),
                  ),

                  const SizedBox(height: 12),

                  Text(
                    classSession.time,
                    style:
                        const TextStyle(
                      fontSize: 16,
                      color:
                          Colors.black54,
                    ),
                  ),

                  const SizedBox(height: 6),

                  Text(
                    'Phòng ${classSession.room}',
                    style:
                        const TextStyle(
                      fontSize: 16,
                      color:
                          Colors.black54,
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 20),

            Container(
              width: double.infinity,
              padding:
                  const EdgeInsets.all(20),

              decoration:
                  BoxDecoration(
                color: Colors.white,
                borderRadius:
                    BorderRadius.circular(20),
              ),

              child: const Column(
                crossAxisAlignment:
                    CrossAxisAlignment.start,

                children: [
                  Text(
                    'Yêu cầu check-in',
                    style:
                        TextStyle(
                      fontSize: 18,
                      fontWeight:
                          FontWeight.bold,
                    ),
                  ),

                  SizedBox(height: 12),

                  Text(
                    '• Check-in trong thời gian được phép\n'
                    '• Chụp ảnh trực tiếp bằng camera\n'
                    '• Hệ thống sẽ kiểm tra phòng học',
                    style:
                        TextStyle(
                      height: 1.6,
                      color:
                          Colors.black54,
                    ),
                  ),
                ],
              ),
            ),

            const Spacer(),

            SizedBox(
              width: double.infinity,
              child: classSession.isCheckInExcluded
                  ? Container(
                      height: 54,
                      decoration: BoxDecoration(
                        color: Colors.black.withOpacity(0.06),
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: const Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(
                            Icons.info_outline_rounded,
                            color: Colors.black54,
                          ),
                          SizedBox(width: 9),
                          Text(
                            'Môn này không tính Check-in',
                            style: TextStyle(
                              color: Colors.black54,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ],
                      ),
                    )
                  : classSession.completed
                  ? Container(
                      height: 54,
                      decoration: BoxDecoration(
                        color: Colors.green.withOpacity(0.10),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(
                          color: Colors.green.withOpacity(0.30),
                        ),
                      ),
                      child: const Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(
                            Icons.check_circle_rounded,
                            color: Colors.green,
                          ),
                          SizedBox(width: 9),
                          Text(
                            'Bạn đã Check-in hôm nay',
                            style: TextStyle(
                              color: Colors.green,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ],
                      ),
                    )
                  : SizedBox(
                      height: 54,
                      child: FilledButton.icon(
                        onPressed: () {
                          if (!isCheckInAllowed(classSession)) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text(
                                  'Chưa đến thời gian Check-in hoặc lớp đã kết thúc.',
                                ),
                              ),
                            );
                            return;
                          }

                          Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => CameraCheckInScreen(
                                classSession: classSession,
                              ),
                            ),
                          );
                        },
                        icon: const Icon(
                          Icons.camera_alt,
                        ),
                        label: const Text(
                          'Check-in ngay',
                        ),
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

// ============================================================
// MENU CARD
// ============================================================

class MenuCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final VoidCallback onTap;

  const MenuCard({
    super.key,
    required this.icon,
    required this.title,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius:
          BorderRadius.circular(20),

      child: Container(
        padding:
            const EdgeInsets.symmetric(
          vertical: 22,
          horizontal: 12,
        ),

        decoration:
            BoxDecoration(
          color: Colors.white,
          borderRadius:
              BorderRadius.circular(20),
        ),

        child: Column(
          children: [
            Icon(
              icon,
              size: 30,
              color:
                  const Color(0xFF005BAC),
            ),

            const SizedBox(height: 8),

            Text(
              title,
              style:
                  const TextStyle(
                fontWeight:
                    FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ============================================================
// CAMERA CHECK-IN
// ============================================================

class CameraCheckInScreen
    extends StatefulWidget {
  final ClassSession classSession;

  const CameraCheckInScreen({
    super.key,
    required this.classSession,
  });

  @override
  State<CameraCheckInScreen>
      createState() =>
          _CameraCheckInScreenState();
}

class _CameraCheckInScreenState
    extends State<CameraCheckInScreen> {
  CameraController? _controller;

  bool _isReady = false;
  bool _isProcessing = false;

  @override
  void initState() {
    super.initState();
    _initializeCamera();
  }

  Future<void> _initializeCamera() async {
    try {
      final cameras =
          await availableCameras();

      if (cameras.isEmpty) {
        return;
      }

      final camera = cameras.firstWhere(
        (camera) =>
            camera.lensDirection ==
            CameraLensDirection.back,
        orElse: () => cameras.first,
      );

      final controller =
          CameraController(
        camera,
        ResolutionPreset.high,
        enableAudio: false,
      );

      await controller.initialize();

      if (!mounted) {
        await controller.dispose();
        return;
      }

      setState(() {
        _controller = controller;
        _isReady = true;
      });
    } catch (e) {
      debugPrint(
        'Camera error: $e',
      );
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  Future<void> _takePhoto() async {
    if (_controller == null ||
        !_controller!
            .value
            .isInitialized ||
        _isProcessing) {
      return;
    }

    setState(() {
      _isProcessing = true;
    });

    try {
      final XFile image =
          await _controller!.takePicture();

      debugPrint(
        'Captured image: ${image.path}',
      );

      if (!mounted) return;

      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (_) =>
              RoomVerificationScreen(
            classSession:
                widget.classSession,
            imagePath:
                image.path,
          ),
        ),
      );
    } catch (e) {
      debugPrint(
        'Capture error: $e',
      );

      if (!mounted) return;

      setState(() {
        _isProcessing = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,

      appBar: AppBar(
        backgroundColor:
            Colors.black,
        foregroundColor:
            Colors.white,
        title:
            const Text('Check-in'),
      ),

      body: !_isReady
          ? const Center(
              child:
                  CircularProgressIndicator(
                color: Colors.white,
              ),
            )
          : Stack(
              children: [
                Positioned.fill(
                  child: CameraPreview(
                    _controller!,
                  ),
                ),

                Positioned(
                  left: 24,
                  right: 24,
                  top: 30,

                  child: Container(
                    padding:
                        const EdgeInsets.all(16),

                    decoration:
                        BoxDecoration(
                      color: Colors.black
                          .withOpacity(0.65),
                      borderRadius:
                          BorderRadius.circular(
                        16,
                      ),
                    ),

                    child: Column(
                      children: [
                        const Text(
                          'Phòng cần xác minh',
                          style:
                              TextStyle(
                            color:
                                Colors.white70,
                            fontSize: 13,
                          ),
                        ),

                        const SizedBox(
                            height: 4),

                        Text(
                          widget.classSession
                              .room,

                          style:
                              const TextStyle(
                            color:
                                Colors.white,
                            fontSize: 28,
                            fontWeight:
                                FontWeight.bold,
                          ),
                        ),

                        const SizedBox(
                            height: 4),

                        const Text(
                          'Đưa bảng tên phòng vào khung hình',
                          textAlign:
                              TextAlign.center,
                          style:
                              TextStyle(
                            color:
                                Colors.white70,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),

                Center(
                  child: Container(
                    width: 300,
                    height: 180,

                    decoration:
                        BoxDecoration(
                      border:
                          Border.all(
                        color: Colors.white,
                        width: 3,
                      ),
                      borderRadius:
                          BorderRadius.circular(
                        20,
                      ),
                    ),
                  ),
                ),

                Positioned(
                  bottom: 35,
                  left: 0,
                  right: 0,

                  child: Center(
                    child:
                        GestureDetector(
                      onTap: _takePhoto,

                      child: Container(
                        width: 78,
                        height: 78,

                        decoration:
                            BoxDecoration(
                          shape:
                              BoxShape.circle,
                          color:
                              Colors.white,
                          border:
                              Border.all(
                            color:
                                Colors.white54,
                            width: 5,
                          ),
                        ),

                        child: _isProcessing
                            ? const Padding(
                                padding:
                                    EdgeInsets.all(
                                  20,
                                ),
                                child:
                                    CircularProgressIndicator(),
                              )
                            : const Icon(
                                Icons.camera_alt,
                                color:
                                    Color(
                                  0xFF005BAC,
                                ),
                                size: 32,
                              ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}

// ============================================================
// ROOM VERIFICATION
// ============================================================

class RoomVerificationScreen extends StatefulWidget {
  final ClassSession classSession;
  final String imagePath;

  const RoomVerificationScreen({
    super.key,
    required this.classSession,
    required this.imagePath,
  });

  @override
  State<RoomVerificationScreen> createState() =>
      _RoomVerificationScreenState();
}

bool isCheckInAllowed(ClassSession classSession) {
  final now = DateTime.now();

  final startParts = classSession.startTime.split(':');
  final endParts = classSession.endTime.split(':');

  final startHour = int.parse(startParts[0]);
  final startMinute = int.parse(startParts[1]);

  final endHour = int.parse(endParts[0]);
  final endMinute = int.parse(endParts[1]);

  final classStart = DateTime(
    now.year,
    now.month,
    now.day,
    startHour,
    startMinute,
  );

  final classEnd = DateTime(
    now.year,
    now.month,
    now.day,
    endHour,
    endMinute,
  );

  final checkInStart = classStart.subtract(
    const Duration(minutes: 15),
  );

  return !now.isBefore(checkInStart) && now.isBefore(classEnd);
}

class _RoomVerificationScreenState
    extends State<RoomVerificationScreen> {
  bool isChecking = true;
  bool isSuccess = false;
  String? errorMessage;

  String? detectedRoom;
  double? confidence;
  String? uploadedImagePath;

  @override
  void initState() {
    super.initState();
    _verifyRoom();
  }

  Future<void> _verifyRoom() async {
    if (!mounted) return;

    setState(() {
      isChecking = true;
      isSuccess = false;
      errorMessage = null;
      detectedRoom = null;
      confidence = null;
      uploadedImagePath = null;
    });

    final user = supabase.auth.currentUser;

    if (user == null) {
      if (!mounted) return;

      setState(() {
        isChecking = false;
        errorMessage = 'Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.';
      });
      return;
    }

    try {
      // ========================================================
      // 1. KIỂM TRA THỜI GIAN CHECK-IN
      // ========================================================

      if (!isCheckInAllowed(widget.classSession)) {
        throw Exception(
          'Đã hết thời gian Check-in cho lớp này.',
        );
      }

      final now = DateTime.now();

      final startOfDay = DateTime(
        now.year,
        now.month,
        now.day,
      );

      final endOfDay = startOfDay.add(
        const Duration(days: 1),
      );

      // ========================================================
      // 2. KIỂM TRA ĐÃ CHECK-IN LỚP NÀY HÔM NAY CHƯA
      // ========================================================

      final existing = await supabase
          .from('check_ins')
          .select('id')
          .eq('user_id', user.id)
          .eq(
            'class_session_id',
            widget.classSession.id,
          )
          .gte(
            'checked_in_at',
            startOfDay.toUtc().toIso8601String(),
          )
          .lt(
            'checked_in_at',
            endOfDay.toUtc().toIso8601String(),
          )
          .maybeSingle();

      if (existing != null) {
        if (!mounted) return;

        Navigator.pushReplacement(
          context,
          MaterialPageRoute(
            builder: (_) => CheckInSuccessScreen(
              classSession: widget.classSession,
              alreadyCheckedIn: true,
            ),
          ),
        );
        return;
      }

      // ========================================================
      // 3. KIỂM TRA FILE ẢNH CAMERA
      // ========================================================

      final imageFile = File(widget.imagePath);

      if (!await imageFile.exists()) {
        throw Exception(
          'Không tìm thấy file ảnh: ${widget.imagePath}',
        );
      }

      // ========================================================
      // 4. UPLOAD ẢNH LÊN SUPABASE STORAGE
      // ========================================================

      final fileName =
          '${now.millisecondsSinceEpoch}.jpg';

      final filePath =
          '${user.id}/${widget.classSession.id}/$fileName';

      debugPrint('=== AI ROOM VERIFICATION START ===');
      debugPrint('USER ID: ${user.id}');
      debugPrint('LOCAL IMAGE: ${widget.imagePath}');
      debugPrint('STORAGE PATH: $filePath');
      debugPrint('EXPECTED ROOM: ${widget.classSession.room}');

      final uploadedPath = await supabase.storage
          .from('check-in-images')
          .upload(
            filePath,
            imageFile,
            fileOptions: const FileOptions(
              contentType: 'image/jpeg',
              upsert: false,
            ),
          );

      uploadedImagePath = uploadedPath;

      debugPrint(
        'UPLOAD SUCCESS: $uploadedPath',
      );

      // ========================================================
      // 5. GỌI SUPABASE EDGE FUNCTION -> GEMINI
      // ========================================================

      debugPrint('CALLING verify-room EDGE FUNCTION...');

      final response = await supabase.functions.invoke(
        'verify-room',
        body: {
          'image_path': uploadedPath,
          'expected_room': widget.classSession.room,
        },
      );

      debugPrint(
        'EDGE FUNCTION RESPONSE: ${response.data}',
      );

      final data = response.data;

      if (data is! Map) {
        throw Exception(
          'Phản hồi từ hệ thống xác minh không hợp lệ.',
        );
      }

      final result = Map<String, dynamic>.from(data);

      if (result['error'] != null) {
        throw Exception(
          result['error'].toString(),
        );
      }

      final aiDetectedRoom =
          result['detected_room']?.toString().trim() ?? '';

      final aiConfidence =
          (result['confidence'] as num?)?.toDouble() ?? 0.0;

      final verified = result['verified'] == true;

      if (!mounted) return;

      setState(() {
        isChecking = false;
        isSuccess = verified;
        detectedRoom = aiDetectedRoom.isEmpty
            ? null
            : aiDetectedRoom;
        confidence = aiConfidence;

        if (!verified) {
          if (aiDetectedRoom.isEmpty) {
            errorMessage =
                'Không đọc được biển phòng. Vui lòng chụp rõ biển phòng.';
          } else if (aiDetectedRoom.toUpperCase() !=
              widget.classSession.room.toUpperCase()) {
            errorMessage =
                'Phòng phát hiện ($aiDetectedRoom) không khớp với phòng ${widget.classSession.room}.';
          } else {
            errorMessage =
                'Độ tin cậy của AI chưa đủ để xác minh phòng.';
          }
        }
      });

      debugPrint(
        'AI DETECTED ROOM: $aiDetectedRoom',
      );
      debugPrint(
        'AI CONFIDENCE: $aiConfidence',
      );
      debugPrint(
        'AI VERIFIED: $verified',
      );
    } catch (e, stackTrace) {
      debugPrint('=== AI ROOM VERIFICATION ERROR ===');
      debugPrint('ERROR: $e');
      debugPrint('STACK TRACE: $stackTrace');

      if (!mounted) return;

      setState(() {
        isChecking = false;
        isSuccess = false;
        errorMessage = e.toString().replaceFirst(
          'Exception: ',
          '',
        );
      });
    }
  }

  Future<void> _completeCheckIn() async {
    debugPrint('=== COMPLETE CHECK-IN START ===');

    final user = supabase.auth.currentUser;

    if (user == null) {
      debugPrint('ERROR: No logged-in user');
      return;
    }

    // Không cho INSERT nếu AI chưa xác minh thành công.
    if (!isSuccess || uploadedImagePath == null) {
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Chưa xác minh phòng thành công.',
          ),
        ),
      );
      return;
    }

    if (!isCheckInAllowed(widget.classSession)) {
      debugPrint('ERROR: Check-in time is not allowed');

      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Đã hết thời gian Check-in cho lớp này.',
          ),
        ),
      );

      return;
    }

    try {
      final now = DateTime.now();

      final startOfDay = DateTime(
        now.year,
        now.month,
        now.day,
      );

      final endOfDay = startOfDay.add(
        const Duration(days: 1),
      );

      // ========================================================
      // KIỂM TRA DUPLICATE LẦN CUỐI TRƯỚC KHI INSERT
      // ========================================================

      final existing = await supabase
          .from('check_ins')
          .select('id')
          .eq('user_id', user.id)
          .eq(
            'class_session_id',
            widget.classSession.id,
          )
          .gte(
            'checked_in_at',
            startOfDay.toUtc().toIso8601String(),
          )
          .lt(
            'checked_in_at',
            endOfDay.toUtc().toIso8601String(),
          )
          .maybeSingle();

      if (existing != null) {
        if (!mounted) return;

        Navigator.pushReplacement(
          context,
          MaterialPageRoute(
            builder: (_) => CheckInSuccessScreen(
              classSession: widget.classSession,
              alreadyCheckedIn: true,
            ),
          ),
        );
        return;
      }

      // ========================================================
      // INSERT CHECK-IN SAU KHI AI ĐÃ VERIFY
      // ========================================================

      debugPrint('INSERTING VERIFIED CHECK-IN...');

      await supabase.from('check_ins').insert({
        'user_id': user.id,
        'class_session_id': widget.classSession.id,
        'checked_in_at': now.toUtc().toIso8601String(),
        'room': widget.classSession.room,
        'image_url': uploadedImagePath,
        'verification_status': 'verified',
      });

      debugPrint('CHECK-IN INSERT SUCCESS');
      debugPrint(
        'IMAGE PATH SAVED TO DB: $uploadedImagePath',
      );

      if (!mounted) return;

      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (_) => CheckInSuccessScreen(
            classSession: widget.classSession,
            alreadyCheckedIn: false,
          ),
        ),
      );
    } catch (e, stackTrace) {
      debugPrint('=== CHECK-IN ERROR ===');
      debugPrint('ERROR: $e');
      debugPrint('STACK TRACE: $stackTrace');

      if (!mounted) return;

      setState(() {
        errorMessage = e.toString().replaceFirst(
          'Exception: ',
          '',
        );
      });
    }
  }

  void _retakePhoto() {
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final confidencePercent =
        confidence == null
            ? null
            : (confidence! * 100).toStringAsFixed(0);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Xác minh phòng'),
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                maxWidth: 420,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 300),
                    width: 110,
                    height: 110,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: isSuccess
                          ? Colors.green.shade50
                          : errorMessage != null
                              ? Colors.red.shade50
                              : Colors.blue.shade50,
                    ),
                    child: Icon(
                      isSuccess
                          ? Icons.check_circle
                          : errorMessage != null
                              ? Icons.error_outline
                              : Icons.location_searching,
                      size: 64,
                      color: isSuccess
                          ? Colors.green
                          : errorMessage != null
                              ? Colors.red
                              : Colors.blue,
                    ),
                  ),

                  const SizedBox(height: 28),

                  Text(
                    isChecking
                        ? 'Đang xác minh phòng học'
                        : isSuccess
                            ? 'Phòng học đã được xác minh'
                            : 'Không thể xác minh phòng',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                    ),
                  ),

                  const SizedBox(height: 12),

                  Text(
                    isChecking
                        ? 'Đang tải ảnh và dùng AI để đọc biển phòng ${widget.classSession.room}...'
                        : isSuccess
                            ? 'AI đã xác nhận ảnh khớp với phòng học yêu cầu.'
                            : errorMessage ??
                                'Vui lòng thử lại bằng một ảnh rõ hơn.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 15,
                      color: Colors.grey.shade600,
                    ),
                  ),

                  const SizedBox(height: 28),

                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      color: Colors.grey.shade50,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: Colors.grey.shade200,
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _InfoRow(
                          icon: Icons.book_outlined,
                          label: 'Môn học',
                          value: widget.classSession.subject,
                        ),
                        const SizedBox(height: 14),
                        _InfoRow(
                          icon: Icons.meeting_room_outlined,
                          label: 'Phòng yêu cầu',
                          value: widget.classSession.room,
                        ),
                        if (detectedRoom != null) ...[
                          const SizedBox(height: 14),
                          _InfoRow(
                            icon: Icons.document_scanner_outlined,
                            label: 'AI phát hiện',
                            value: detectedRoom!,
                          ),
                        ],
                        if (confidencePercent != null) ...[
                          const SizedBox(height: 14),
                          _InfoRow(
                            icon: Icons.analytics_outlined,
                            label: 'Độ tin cậy',
                            value: '$confidencePercent%',
                          ),
                        ],
                        const SizedBox(height: 14),
                        _InfoRow(
                          icon: Icons.access_time,
                          label: 'Thời gian',
                          value: widget.classSession.time,
                        ),
                      ],
                    ),
                  ),

                  if (isChecking) ...[
                    const SizedBox(height: 28),
                    const CircularProgressIndicator(),
                  ],

                  if (isSuccess) ...[
                    const SizedBox(height: 28),
                    SizedBox(
                      width: double.infinity,
                      height: 52,
                      child: ElevatedButton(
                        onPressed: _completeCheckIn,
                        child: const Text(
                          'Hoàn tất Check-in',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ),
                  ],

                  if (!isChecking && !isSuccess) ...[
                    const SizedBox(height: 28),
                    SizedBox(
                      width: double.infinity,
                      height: 52,
                      child: ElevatedButton.icon(
                        onPressed: _retakePhoto,
                        icon: const Icon(Icons.camera_alt),
                        label: const Text(
                          'Chụp lại ảnh',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;

  const _InfoRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          icon,
          size: 22,
          color: Colors.blue,
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: TextStyle(
                  fontSize: 13,
                  color: Colors.grey.shade600,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                value,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// ============================================================
// CHECK-IN SUCCESS
// ============================================================

class CheckInSuccessScreen extends StatelessWidget {
  final ClassSession classSession;
  final bool alreadyCheckedIn;

  const CheckInSuccessScreen({
    super.key,
    required this.classSession,
    required this.alreadyCheckedIn,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Check-in'),
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(
                Icons.check_circle,
                color: Colors.green,
                size: 100,
              ),
              const SizedBox(height: 24),
              Text(
                alreadyCheckedIn
                    ? 'Bạn đã Check-in lớp này!'
                    : 'Check-in thành công!',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 16),
              Text(
                classSession.subject,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 18,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Phòng ${classSession.room}',
                style: const TextStyle(
                  fontSize: 16,
                ),
              ),
              const SizedBox(height: 32),
              ElevatedButton(
                onPressed: () {
                  Navigator.popUntil(
                    context,
                    (route) => route.isFirst,
                  );
                },
                child: const Text(
                  'Về trang chủ',
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}