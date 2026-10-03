import 'dart:io';
import 'dart:async';
import 'dart:typed_data';
import 'package:file_picker/file_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:open_filex/open_filex.dart';

import 'package:flutter/material.dart';
import 'meme_feedback.dart';
import 'dart:ui' show FontFeature;
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

// Giao diện sáng/tối dùng chung cho toàn app.
final ValueNotifier<ThemeMode> appThemeMode =
    ValueNotifier<ThemeMode>(ThemeMode.light);

Future<void> loadUserThemePreference() async {
  final user = supabase.auth.currentUser;
  if (user == null) {
    appThemeMode.value = ThemeMode.light;
    return;
  }

  try {
    final result = await supabase.rpc('get_my_theme_mode');
    final mode = result?.toString().toLowerCase();
    appThemeMode.value =
        mode == 'dark' ? ThemeMode.dark : ThemeMode.light;
  } catch (e) {
    // Nếu RPC chưa được cập nhật hoặc có lỗi mạng, giữ mặc định sáng.
    debugPrint('Load theme preference error: $e');
    appThemeMode.value = ThemeMode.light;
  }
}

Future<void> saveUserThemePreference(ThemeMode mode) async {
  final user = supabase.auth.currentUser;
  if (user == null) return;

  try {
    await supabase.rpc(
      'set_my_theme_mode',
      params: {
        'p_theme_mode':
            mode == ThemeMode.dark ? 'dark' : 'light',
      },
    );
  } catch (e) {
    debugPrint('Save theme preference error: $e');
  }
}

final FlutterLocalNotificationsPlugin localNotifications =
    FlutterLocalNotificationsPlugin();

class NotificationService {
  static const String _channelId = 'class_reminders';
  static const String _channelName = 'Nhắc lịch học';
  static const String _channelDescription =
      'Nhắc trước 30 phút khi tiết học sắp bắt đầu.';

  static Future<void> initialize() async {
    tz.initializeTimeZones();
    tz.setLocalLocation(tz.getLocation('Asia/Ho_Chi_Minh'));

    const settings = InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
    );

    await localNotifications.initialize(
      settings: settings,
      onDidReceiveNotificationResponse: (response) async {
        final notificationId = response.id;
        if (notificationId != null && notificationId >= 0) {
          await localNotifications.cancel(id: notificationId);
        }
      },
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

    // Android 12+ requires special access for exact alarms. We request it
    // so the reminder can fire at the exact scheduled minute, including
    // while the device is idle.
    try {
      await android?.requestExactAlarmsPermission();
    } catch (e) {
      debugPrint('Request exact alarm permission error: $e');
    }
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
    // Do not call cancelAll() here: a notification that has already been
    // delivered is no longer a pending request. Refreshing the timetable
    // should update future alarms without dismissing a visible reminder.
    final pending = await localNotifications.pendingNotificationRequests();
    final desiredIds = <int>{};

    for (final classSession in classes) {
      // Inactive sessions are soft-deleted: keep their check-in history,
      // but never schedule reminders for them.
      if (!classSession.isActive) continue;

      final startParts = classSession.startTime.split(':');
      final endParts = classSession.endTime.split(':');
      if (classSession.id.isEmpty ||
          startParts.length < 2 ||
          endParts.length < 2 ||
          classSession.dayOfWeek < 1 ||
          classSession.dayOfWeek > 7) {
        continue;
      }

      final startHour = int.tryParse(startParts[0]);
      final startMinute = int.tryParse(startParts[1]);
      final endHour = int.tryParse(endParts[0]);
      final endMinute = int.tryParse(endParts[1]);
      if (startHour == null ||
          startMinute == null ||
          endHour == null ||
          endMinute == null) {
        continue;
      }

      final notificationId = _notificationId(classSession.id);
      desiredIds.add(notificationId);

      final now = tz.TZDateTime.now(tz.local);
      var scheduled = tz.TZDateTime(
        tz.local,
        now.year,
        now.month,
        now.day,
        startHour,
        startMinute,
      ).subtract(const Duration(minutes: 30));

      final daysUntil =
          (classSession.dayOfWeek - now.weekday + 7) % 7;
      scheduled = scheduled.add(Duration(days: daysUntil));

      // If today's reminder time has passed, schedule next week's reminder.
      if (!scheduled.isAfter(now)) {
        scheduled = scheduled.add(const Duration(days: 7));
      }

      final classStart = scheduled.add(const Duration(minutes: 30));
      var classEnd = tz.TZDateTime(
        tz.local,
        classStart.year,
        classStart.month,
        classStart.day,
        endHour,
        endMinute,
      );
      if (!classEnd.isAfter(classStart)) {
        classEnd = classEnd.add(const Duration(days: 1));
      }

      final timeoutAfter = classEnd.difference(scheduled).inMilliseconds;

      await localNotifications.zonedSchedule(
        id: notificationId,
        title: 'Sắp đến giờ học',
        body: 'Tiết học sẽ bắt đầu lúc '
            '${_formatTimeHHmm(classSession.startTime)} '
            'tại phòng ${classSession.room}.',
        scheduledDate: scheduled,
        notificationDetails: NotificationDetails(
          android: AndroidNotificationDetails(
            _channelId,
            _channelName,
            channelDescription: _channelDescription,
            importance: Importance.high,
            priority: Priority.high,
            playSound: true,
            // Keep the notification visible and non-dismissible until the
            // class ends; tapping it dismisses it via the callback above.
            ongoing: true,
            autoCancel: false,
            onlyAlertOnce: true,
            timeoutAfter: timeoutAfter > 0
                ? timeoutAfter
                : const Duration(minutes: 30).inMilliseconds,
            category: AndroidNotificationCategory.reminder,
          ),
        ),
        androidScheduleMode: AndroidScheduleMode.exactAllowWhileIdle,
        matchDateTimeComponents: DateTimeComponents.dayOfWeekAndTime,
      );
    }

    // Remove only obsolete *pending* alarms. A notification already shown
    // to the user is not in this list and therefore remains visible until
    // tapped or timed out at the end of class.
    for (final request in pending) {
      if (!desiredIds.contains(request.id)) {
        await localNotifications.cancel(id: request.id);
      }
    }
  }

  static Future<void> syncCurrentUserSchedule() async {
    final user = supabase.auth.currentUser;

    if (user == null) {
      await localNotifications.cancelAll();
      return;
    }

    try {
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

      final classes = (data as List)
          .map(
            (item) => ClassSession.fromMap(
              Map<String, dynamic>.from(item),
            ),
          )
          .toList();

      await syncSchedule(classes);

      final pending = await pendingCount();
      debugPrint(
        'Startup/login schedule notifications synced: $pending',
      );
    } catch (e) {
      debugPrint('Sync current user schedule notifications error: $e');
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
    return ValueListenableBuilder<ThemeMode>(
      valueListenable: appThemeMode,
      builder: (context, mode, _) {
        return MaterialApp(
          debugShowCheckedModeBanner: false,
          title: 'DUT Campus Streak',
          themeMode: mode,
          theme: ThemeData(
            useMaterial3: true,
            brightness: Brightness.light,
            colorScheme: ColorScheme.fromSeed(
              seedColor: const Color(0xFF005BAC),
              brightness: Brightness.light,
            ),
            scaffoldBackgroundColor: const Color(0xFFEAF4FF),
          ),
          darkTheme: ThemeData(
            useMaterial3: true,
            brightness: Brightness.dark,
            colorScheme: ColorScheme.fromSeed(
              seedColor: const Color(0xFF4EA1FF),
              brightness: Brightness.dark,
            ),
            scaffoldBackgroundColor: const Color(0xFF0F1720),
            cardColor: const Color(0xFF182331),
          ),
          home: const AuthGate(),
        );
      },
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
        await loadUserThemePreference();
        // Schedule reminders as soon as a saved session is restored.
        // This does not depend on opening the Schedule screen.
        await NotificationService.syncCurrentUserSchedule();
      } else {
        appThemeMode.value = ThemeMode.light;
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
        : const MainNavigationScreen();
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
      await loadUserThemePreference();
      // Schedule reminders immediately after login so they work even if
      // the user never opens the Schedule screen.
      await NotificationService.syncCurrentUserSchedule();

      if (!mounted) return;

      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(builder: (_) => const MainNavigationScreen()),
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

    // Login screen is intentionally theme-independent.
    // It always uses the original light appearance, even if the user
    // previously selected dark mode while inside the app.
    return Theme(
      data: ThemeData(
        useMaterial3: true,
        brightness: Brightness.light,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF005BAC),
          brightness: Brightness.light,
        ),
        scaffoldBackgroundColor: Colors.white,
      ),
      child: Scaffold(
        backgroundColor: Colors.white,
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
                    color: Colors.white.withValues(alpha: 0.06),
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
                    color: Colors.white.withValues(alpha: 0.05),
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
                          color: Colors.white.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(30),
                          border: Border.all(
                            color: Colors.white.withValues(alpha: 0.22),
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

                      Text(
                        'DUT Campus Streak',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.surface,
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
                              color: Colors.black.withValues(alpha: 0.18),
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
                                      Colors.red.withValues(alpha: 0.07),
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
                        '© 2026 Nguyễn Tấn Phú. All rights reserved.',
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
        MaterialPageRoute(builder: (_) => const MainNavigationScreen()),
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
                    color: Colors.red.withValues(alpha: 0.08),
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
  final VoidCallback? onBackToHome;

  const ProfileScreen({super.key, this.onBackToHome});

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
      appThemeMode.value = ThemeMode.light;

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
      appThemeMode.value = ThemeMode.light;
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
        leading: IconButton(
          tooltip: 'Về trang chủ',
          icon: const Icon(Icons.arrow_back),
          onPressed: widget.onBackToHome ?? () => Navigator.maybePop(context),
        ),
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

            const SizedBox(height: 22),
            Card(
              elevation: 0,
              child: ValueListenableBuilder<ThemeMode>(
                valueListenable: appThemeMode,
                builder: (context, mode, _) {
                  final isDark = mode == ThemeMode.dark;
                  return SwitchListTile.adaptive(
                    secondary: Icon(
                      isDark ? Icons.dark_mode_rounded : Icons.light_mode_rounded,
                    ),
                    title: const Text(
                      'Giao diện tối',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                    subtitle: Text(isDark ? 'Đang dùng giao diện tối' : 'Đang dùng giao diện sáng'),
                    value: isDark,
                    onChanged: (value) async {
                      final newMode =
                          value ? ThemeMode.dark : ThemeMode.light;

                      // Đổi UI ngay lập tức. Sau đó lưu preference vào
                      // profiles.theme_mode của đúng tài khoản đang đăng nhập.
                      appThemeMode.value = newMode;
                      await saveUserThemePreference(newMode);
                    },
                  );
                },
              ),
            ),

            const SizedBox(height: 12),
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
    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
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
                color: colorScheme.surface,
                borderRadius: BorderRadius.circular(24),
                boxShadow: [
                  BoxShadow(
                    color: _blue.withValues(alpha: 0.12),
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
          Center(
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
            colorScheme: colorScheme,
            icon: Icons.person_outline_rounded,
            title: 'Tác giả / Nhóm phát triển',
            children: [
              Text(
                'Nguyễn Tấn Phú',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
              ),
              SizedBox(height: 6),
              Text(
                'Sinh viên phát triển sản phẩm DUT Campus Streak.',
                style: TextStyle(color: colorScheme.onSurfaceVariant, height: 1.4),
              ),
            ],
          ),
          const SizedBox(height: 14),
          _infoCard(
            colorScheme: colorScheme,
            icon: Icons.mail_outline_rounded,
            title: 'Liên hệ',
            children: [
              Text(
                'phu759042@gmail.com',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
              ),
              SizedBox(height: 6),
              Text(
                'Email liên hệ về sản phẩm, góp ý và báo lỗi.',
                style: TextStyle(color: colorScheme.onSurfaceVariant, height: 1.4),
              ),
            ],
          ),
          const SizedBox(height: 14),
          _infoCard(
            colorScheme: colorScheme,
            icon: Icons.copyright_rounded,
            title: 'Bản quyền & sở hữu trí tuệ',
            children: [
              Text(
                'DUT Campus Streak © 2026',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
              ),
              SizedBox(height: 8),
              Text(
                'Mã nguồn, giao diện, thiết kế và nội dung do tác giả tự phát triển được bảo lưu quyền sở hữu trí tuệ trong phạm vi pháp luật áp dụng. Các thư viện, SDK và thành phần của bên thứ ba tuân theo giấy phép riêng của chúng.',
                style: TextStyle(color: colorScheme.onSurfaceVariant, height: 1.5),
              ),
            ],
          ),
          const SizedBox(height: 14),
          _infoCard(
            colorScheme: colorScheme,
            icon: Icons.info_outline_rounded,
            title: 'Về sản phẩm',
            children: [
              Text(
                'DUT Campus Streak hỗ trợ sinh viên theo dõi lịch học, check-in lớp học, xác minh phòng, duy trì streak và xem thành tích.',
                style: TextStyle(color: colorScheme.onSurfaceVariant, height: 1.5),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _infoCard({
    required ColorScheme colorScheme,
    required IconData icon,
    required String title,
    required List<Widget> children,
  }) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
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
              color: colorScheme.primaryContainer,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: colorScheme.primary),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: colorScheme.onSurface),
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
// MAIN NAVIGATION SHELL
// Keeps the navigation bar mounted while Home/Profile content loads.
// The selection pill animates horizontally when switching tabs.
// ============================================================

class MainNavigationScreen extends StatefulWidget {
  const MainNavigationScreen({super.key});

  @override
  State<MainNavigationScreen> createState() => _MainNavigationScreenState();
}

class _MainNavigationScreenState extends State<MainNavigationScreen> {
  int _selectedIndex = 0;

  void _selectTab(int index) {
    if (index == _selectedIndex) return;
    setState(() => _selectedIndex = index);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final primary = theme.colorScheme.primary;

    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      body: IndexedStack(
        index: _selectedIndex,
        children: [
          HomeScreen(onOpenProfile: () => _selectTab(1)),
          ProfileScreen(onBackToHome: () => _selectTab(0)),
        ],
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 0, 18, 12),
          child: Container(
            height: 62,
            decoration: BoxDecoration(
              color: theme.cardColor,
              borderRadius: BorderRadius.circular(32),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.08),
                  blurRadius: 18,
                  offset: const Offset(0, 6),
                ),
              ],
            ),
            child: LayoutBuilder(
              builder: (context, constraints) {
                final itemWidth = constraints.maxWidth / 2;
                return Stack(
                  children: [
                    AnimatedPositioned(
                      duration: const Duration(milliseconds: 320),
                      curve: Curves.easeInOutCubic,
                      left: itemWidth * _selectedIndex + 5,
                      top: 5,
                      bottom: 5,
                      width: itemWidth - 10,
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          color: primary.withValues(alpha: 0.10),
                          borderRadius: BorderRadius.circular(28),
                        ),
                      ),
                    ),
                    Row(
                      children: [
                        Expanded(
                          child: _NavigationTab(
                            icon: Icons.home_rounded,
                            selected: _selectedIndex == 0,
                            onTap: () => _selectTab(0),
                          ),
                        ),
                        Expanded(
                          child: _NavigationTab(
                            icon: Icons.person_outline_rounded,
                            selected: _selectedIndex == 1,
                            onTap: () => _selectTab(1),
                          ),
                        ),
                      ],
                    ),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

class _NavigationTab extends StatelessWidget {
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  const _NavigationTab({
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Center(
        child: AnimatedScale(
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOut,
          scale: selected ? 1.05 : 1.0,
          child: Icon(
            icon,
            color: selected ? colors.primary : colors.onSurfaceVariant,
          ),
        ),
      ),
    );
  }
}

// ============================================================
// HOME
// ============================================================

class HomeScreen extends StatefulWidget {
  final VoidCallback? onOpenProfile;

  const HomeScreen({super.key, this.onOpenProfile});

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
      final data = await supabase.rpc('get_leaderboard');
      final rows = (data as List)
          .map((row) => Map<String, dynamic>.from(row as Map))
          .toList();

      for (final row in rows) {
        if (row['user_id']?.toString() == user.id) {
          // Supabase RPC is the single source of truth.
          // Do not add/subtract anything in Flutter.
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
          color: Colors.red.withValues(alpha: 0.07),
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
          color: Theme.of(context).cardColor,
          borderRadius: BorderRadius.circular(22),
        ),
        child: Column(
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
            color: Theme.of(context).cardColor,
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
                        color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.10),
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
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.onSurfaceVariant,
                              fontSize: 13,
                            ),
                          ),
                          if (classSession.teacher.isNotEmpty) ...[
                            const SizedBox(height: 3),
                            Text(
                              classSession.teacher,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: Theme.of(context).colorScheme.onSurfaceVariant,
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
                          color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.06),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Text(
                          'Không Check-in',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: Theme.of(context).colorScheme.onSurfaceVariant,
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

                    Icon(
                      Icons.chevron_right_rounded,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
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
      color: Theme.of(context).cardColor,
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
                  color: Theme.of(context).colorScheme.primary,
                ),
                const SizedBox(height: 10),
                Text(
                  title,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.primary,
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
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
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
                              .withValues(alpha: 0.22),
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
                          onTap: () {
                            if (widget.onOpenProfile != null) {
                              widget.onOpenProfile!();
                            } else {
                              Navigator.push(
                                context,
                                MaterialPageRoute(
                                  builder: (_) => const ProfileScreen(),
                                ),
                              );
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
                                profile?['email']?.toString() ?? '',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: Colors.white70,
                                  fontSize: 12,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                '${studentCode.toString().isEmpty ? 'Chưa có MSSV' : studentCode}${className.toString().isEmpty ? '' : ' • $className'}',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: Colors.white60,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
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
                                .withValues(alpha: 0.14),
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
                      color: Theme.of(context).cardColor,
                      borderRadius:
                          BorderRadius.circular(22),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black
                              .withValues(alpha: 0.05),
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
                                  style: TextStyle(
                                    color: Theme.of(context).colorScheme.onSurfaceVariant,
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
                                ? Column(
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
                                          color: Theme.of(context).colorScheme.onSurfaceVariant,
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
                                        style: TextStyle(
                                          fontSize: 14,
                                          color: Theme.of(context).colorScheme.onSurface,
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        'Phòng ${nextClass.room}',
                                        style: TextStyle(
                                          fontSize: 13,
                                          color: Theme.of(context).colorScheme.onSurfaceVariant,
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
                    _menuTile(
                      icon: Icons.calendar_month_rounded,
                      title: 'Thời khóa biểu',
                      onTap: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const ScheduleScreen(),
                          ),
                        );
                      },
                    ),
                    _menuTile(
                      icon: Icons.folder_copy_rounded,
                      title: 'Tài liệu',
                      onTap: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const DocumentsScreen(),
                          ),
                        );
                      },
                    ),
                    _menuTile(
                      icon: Icons.flag_rounded,
                      title: 'Deadline',
                      onTap: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const DeadlineScreen(),
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
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
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

// ============================================================
// DEADLINE TASKS
// ============================================================

class DeadlineScreen extends StatefulWidget {
  const DeadlineScreen({super.key});

  @override
  State<DeadlineScreen> createState() => _DeadlineScreenState();
}

class _DeadlineScreenState extends State<DeadlineScreen> {
  List<Map<String, dynamic>> _tasks = [];
  bool _loading = true;
  bool _busy = false;
  String? _error;
  late final Timer _ticker;

  @override
  void initState() {
    super.initState();
    _loadTasks();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker.cancel();
    super.dispose();
  }

  Future<void> _loadTasks() async {
    if (mounted) setState(() { _loading = true; _error = null; });
    try {
      final user = supabase.auth.currentUser;
      if (user == null) throw Exception('Bạn chưa đăng nhập.');
      final data = await supabase.from('deadline_tasks').select()
          .eq('user_id', user.id).order('deadline_at');
      final tasks = List<Map<String, dynamic>>.from(data);
      if (!mounted) return;
      setState(() => _tasks = tasks);
      await _syncTaskNotifications(tasks);
    } catch (e) {
      if (mounted) setState(() => _error = 'Không tải được Deadline: $e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  int _notificationId(String taskId, int slot) {
    var hash = 0;
    for (final c in taskId.codeUnits) {
      hash = (hash * 31 + c) & 0x3fffffff;
    }
    // Dedicated positive ID range, separate from class reminder IDs.
    return -1 - ((hash + slot * 104729) % 500000000);
  }

  Future<void> _showTaskNotification({required int id, required String title,
      required String body, required tz.TZDateTime when}) async {
    if (!when.isAfter(tz.TZDateTime.now(tz.local))) return;
    await localNotifications.zonedSchedule(
      id: id,
      title: title,
      body: body,
      scheduledDate: when,
      notificationDetails: const NotificationDetails(
        android: AndroidNotificationDetails(
          'deadline_reminders', 'Nhắc Deadline',
          channelDescription: 'Nhắc nhiệm vụ sắp đến hạn.',
          importance: Importance.max,
          priority: Priority.high,
        ),
      ),
      androidScheduleMode: AndroidScheduleMode.exactAllowWhileIdle,
    );
  }

  Future<void> _syncTaskNotifications(List<Map<String, dynamic>> tasks) async {
    final now = tz.TZDateTime.now(tz.local);
    final desired = <int>{};
    for (final task in tasks) {
      final id = task['id']?.toString() ?? '';
      if (id.isEmpty || task['is_completed'] == true) continue;
      final deadline = DateTime.tryParse(task['deadline_at']?.toString() ?? '');
      if (deadline == null || !deadline.isAfter(DateTime.now())) continue;
      final localDeadline = tz.TZDateTime.from(deadline, tz.local);
      final title = task['title']?.toString() ?? 'Nhiệm vụ';
      final remaining = deadline.difference(DateTime.now());
      final points = <Duration, int>{
        const Duration(hours: 24): 1,
        const Duration(hours: 12): 2,
        const Duration(hours: 6): 3,
        const Duration(hours: 2): 4,
        const Duration(hours: 1): 5,
        const Duration(minutes: 15): 6,
      };
      var slot = 1;
      if (remaining > const Duration(hours: 24)) {
        // Keep only the next daily reminder for each task; it is resynced
        // whenever the Deadline screen is opened.
        final candidates = <tz.TZDateTime>[];
        for (final hour in [7, 13, 19]) {
          var candidate = tz.TZDateTime(tz.local, now.year, now.month, now.day, hour);
          if (!candidate.isAfter(now)) {
            candidate = candidate.add(const Duration(days: 1));
          }
          candidates.add(candidate);
        }
        candidates.sort((a, b) => a.compareTo(b));
        final next = candidates.first;
        final nid = _notificationId(id, 10 + next.hour);
        desired.add(nid);
        await _showTaskNotification(id: nid, title: 'Deadline sắp tới',
          body: '$title • Hãy tiếp tục hoàn thành nhiệm vụ nhé.', when: next);
      }
      for (final entry in points.entries) {
        final when = localDeadline.subtract(entry.key);
        if (when.isAfter(now)) {
          final nid = _notificationId(id, entry.value);
          desired.add(nid);
          await _showTaskNotification(id: nid, title: 'Sắp đến Deadline',
            body: '$title • Còn ${entry.key.inHours > 0 ? '${entry.key.inHours} giờ' : '15 phút'}.', when: when);
        }
        slot++;
      }
      // Notify at the deadline if it has not been completed. Completing the
      // task cancels this pending notification.
      final overdueId = _notificationId(id, 20);
      desired.add(overdueId);
      await _showTaskNotification(id: overdueId, title: 'Deadline đã đến',
        body: '$title đã đến hạn. Hãy kiểm tra và cập nhật nhiệm vụ.', when: localDeadline);
    }
    final pending = await localNotifications.pendingNotificationRequests();
    for (final request in pending) {
      if (request.id < 0 && request.id >= -500000000 &&
          !desired.contains(request.id)) {
        await localNotifications.cancel(id: request.id);
      }
    }
  }

  Future<void> _cancelTaskNotifications(String taskId) async {
    for (var slot = 1; slot <= 20; slot++) {
      await localNotifications.cancel(id: _notificationId(taskId, slot));
    }
    for (final hour in [7, 13, 19]) {
      await localNotifications.cancel(id: _notificationId(taskId, 10 + hour));
    }
  }

  Future<void> _openTaskDialog({Map<String, dynamic>? task}) async {
    final titleController = TextEditingController(text: task?['title']?.toString() ?? '');
    final descriptionController = TextEditingController(text: task?['description']?.toString() ?? '');
    final existing = task == null ? null : DateTime.tryParse(task['deadline_at'].toString())?.toLocal();
    DateTime selectedDate = existing ?? DateTime.now().add(const Duration(days: 1));
    TimeOfDay selectedTime = existing == null ? const TimeOfDay(hour: 23, minute: 59) : TimeOfDay.fromDateTime(existing);
    bool includeTime = existing != null && !(existing.hour == 0 && existing.minute == 0 && existing.second == 0);
    final result = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(task == null ? 'Tạo Deadline' : 'Chỉnh sửa Deadline'),
          content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(controller: titleController, decoration: const InputDecoration(labelText: 'Tên nhiệm vụ *', hintText: 'Ví dụ: Nộp bài tập Giải tích')),
            const SizedBox(height: 10),
            TextField(controller: descriptionController, maxLines: 2, decoration: const InputDecoration(labelText: 'Mô tả (không bắt buộc)')),
            const SizedBox(height: 12),
            ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.calendar_month), title: const Text('Ngày Deadline'), subtitle: Text('${selectedDate.day.toString().padLeft(2, '0')}/${selectedDate.month.toString().padLeft(2, '0')}/${selectedDate.year}'), onTap: () async {
              final picked = await showDatePicker(context: context, initialDate: selectedDate, firstDate: DateTime.now().subtract(const Duration(days: 3650)), lastDate: DateTime(2100));
              if (picked != null) setDialogState(() => selectedDate = picked);
            }),
            SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Chọn giờ cụ thể'), value: includeTime, onChanged: (v) => setDialogState(() => includeTime = v)),
            if (includeTime) ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.access_time), title: const Text('Giờ Deadline'), subtitle: Text(selectedTime.format(context)), onTap: () async {
              final picked = await showTimePicker(context: context, initialTime: selectedTime);
              if (picked != null) setDialogState(() => selectedTime = picked);
            }) else const Text('Mặc định: hết ngày đã chọn (00:00 ngày hôm sau).', style: TextStyle(fontSize: 12)),
          ])),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Hủy')),
            FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Lưu')),
          ],
        ),
      ),
    );
    if (result != true) return;
    final title = titleController.text.trim();
    if (title.isEmpty) { _message('Vui lòng nhập tên nhiệm vụ.'); return; }
    final deadlineLocal = includeTime
        ? DateTime(selectedDate.year, selectedDate.month, selectedDate.day, selectedTime.hour, selectedTime.minute)
        : DateTime(selectedDate.year, selectedDate.month, selectedDate.day).add(const Duration(days: 1));
    if (!deadlineLocal.isAfter(DateTime.now())) { _message('Deadline phải ở thời điểm trong tương lai.'); return; }
    final user = supabase.auth.currentUser;
    if (user == null) return;
    try {
      setState(() => _busy = true);
      final payload = <String, dynamic>{
        'title': title,
        'description': descriptionController.text.trim().isEmpty ? null : descriptionController.text.trim(),
        'deadline_at': deadlineLocal.toUtc().toIso8601String(),
        'updated_at': DateTime.now().toUtc().toIso8601String(),
      };
      if (task == null) {
        payload['user_id'] = user.id;
        await supabase.from('deadline_tasks').insert(payload);
      } else {
        await supabase.from('deadline_tasks').update(payload).eq('id', task['id']).eq('user_id', user.id);
        await _cancelTaskNotifications(task['id'].toString());
      }
      await _loadTasks();
    } catch (e) {
      _message('Không lưu được Deadline: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _completeTask(Map<String, dynamic> task) async {
    final user = supabase.auth.currentUser;
    if (user == null) return;

    // Determine the feedback from the actual deadline at the moment the
    // user taps Complete. Completing exactly at the deadline counts as success.
    final now = DateTime.now();
    final deadline = DateTime.tryParse(task['deadline_at']?.toString() ?? '');
    final feedbackType = deadline != null && now.isAfter(deadline)
        ? MemeFeedbackType.deadlineFailure
        : MemeFeedbackType.deadlineSuccess;

    try {
      await supabase.from('deadline_tasks').update({
        'is_completed': true,
        'completed_at': now.toUtc().toIso8601String(),
        'updated_at': now.toUtc().toIso8601String(),
      }).eq('id', task['id']).eq('user_id', user.id);
      await _cancelTaskNotifications(task['id'].toString());
      await _loadTasks();
      _message('Đã hoàn thành nhiệm vụ!');

      // Only show feedback after Supabase confirms the task update.
      if (mounted) {
        try {
          await MemeFeedback.show(context, feedbackType);
        } catch (feedbackError, feedbackStackTrace) {
          debugPrint('DEADLINE FEEDBACK ERROR: $feedbackError');
          debugPrintStack(stackTrace: feedbackStackTrace);
        }
      }
    } catch (e) {
      _message('Không cập nhật được nhiệm vụ: $e');
    }
  }

  Future<void> _deleteTask(Map<String, dynamic> task) async {
    final yes = await showDialog<bool>(context: context, builder: (context) => AlertDialog(
      title: const Text('Xóa Deadline?'), content: Text('Bạn có chắc muốn xóa "${task['title']}"?'),
      actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Hủy')),
        FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Xóa'))],
    ));
    if (yes != true) return;
    try {
      await supabase.from('deadline_tasks').delete().eq('id', task['id']);
      await _cancelTaskNotifications(task['id'].toString());
      await _loadTasks();
    } catch (e) { _message('Không xóa được Deadline: $e'); }
  }

  void _message(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  String _remaining(DateTime deadline) {
    final diff = deadline.difference(DateTime.now());
    if (diff.isNegative || diff == Duration.zero) return 'Quá hạn';
    if (diff <= const Duration(hours: 24)) {
      final h = diff.inHours.toString().padLeft(2, '0');
      final m = (diff.inMinutes % 60).toString().padLeft(2, '0');
      final sec = (diff.inSeconds % 60).toString().padLeft(2, '0');
      return '$h:$m:$sec';
    }
    final days = (diff.inSeconds / const Duration(days: 1).inSeconds).ceil();
    return 'Còn $days ngày';
  }

  @override
  Widget build(BuildContext context) {
    final active = _tasks.where((t) => t['is_completed'] != true).toList();
    final completed = _tasks.where((t) => t['is_completed'] == true).toList();

    Widget body;
    if (_loading) {
      body = const Center(child: CircularProgressIndicator());
    } else if (_error != null) {
      body = Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, size: 42),
              const SizedBox(height: 12),
              Text(_error!, textAlign: TextAlign.center),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: _loadTasks,
                child: const Text('Thử lại'),
              ),
            ],
          ),
        ),
      );
    } else {
      body = RefreshIndicator(
        onRefresh: _loadTasks,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 100),
          children: [
            if (active.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 36),
                child: Column(
                  children: [
                    Icon(Icons.flag_outlined, size: 48),
                    SizedBox(height: 12),
                    Text(
                      'Chưa có Deadline nào',
                      style: TextStyle(fontWeight: FontWeight.w700, fontSize: 17),
                    ),
                    SizedBox(height: 4),
                    Text(
                      'Tạo nhiệm vụ để theo dõi thời hạn.',
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              ),
            ...active.map((task) {
              final deadline = DateTime.tryParse(task['deadline_at'].toString())?.toLocal() ?? DateTime.now();
              final overdue = !deadline.isAfter(DateTime.now());
              return Card(
                margin: const EdgeInsets.only(bottom: 12),
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Text(
                              task['title']?.toString() ?? 'Nhiệm vụ',
                              style: const TextStyle(
                                fontWeight: FontWeight.w800,
                                fontSize: 16,
                              ),
                            ),
                          ),
                          PopupMenuButton<String>(
                            onSelected: (v) {
                              if (v == 'edit') _openTaskDialog(task: task);
                              if (v == 'delete') _deleteTask(task);
                            },
                            itemBuilder: (_) => const [
                              PopupMenuItem(
                                value: 'edit',
                                child: Text('Chỉnh sửa / gia hạn'),
                              ),
                              PopupMenuItem(value: 'delete', child: Text('Xóa')),
                            ],
                          ),
                        ],
                      ),
                      if ((task['description']?.toString() ?? '').isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Text(task['description'].toString()),
                        ),
                      Row(
                        children: [
                          Icon(
                            Icons.event,
                            size: 17,
                            color: Theme.of(context).colorScheme.primary,
                          ),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              'Hạn: ${deadline.day.toString().padLeft(2, '0')}/${deadline.month.toString().padLeft(2, '0')}/${deadline.year} ${deadline.hour.toString().padLeft(2, '0')}:${deadline.minute.toString().padLeft(2, '0')}',
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _remaining(deadline),
                        style: TextStyle(
                          fontSize: _remaining(deadline).contains(':') ? 24 : 17,
                          fontWeight: FontWeight.w800,
                          color: overdue
                              ? Colors.red
                              : Theme.of(context).colorScheme.primary,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                      if (overdue)
                        const Padding(
                          padding: EdgeInsets.only(top: 5),
                          child: Text(
                            'Nhiệm vụ chưa hoàn thành — bạn có thể gia hạn hoặc đánh dấu hoàn thành.',
                            style: TextStyle(color: Colors.red, fontSize: 12),
                          ),
                        ),
                      const SizedBox(height: 8),
                      Align(
                        alignment: Alignment.centerRight,
                        child: FilledButton.tonalIcon(
                          onPressed: () => _completeTask(task),
                          icon: const Icon(Icons.check_circle_outline),
                          label: const Text('Hoàn thành'),
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }),
            if (completed.isNotEmpty) ...[
              const Padding(
                padding: EdgeInsets.fromLTRB(4, 12, 4, 8),
                child: Text(
                  'Đã hoàn thành',
                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18),
                ),
              ),
              ...completed.map(
                (task) => Card(
                  child: ListTile(
                    leading: const Icon(Icons.check_circle, color: Colors.green),
                    title: Text(task['title']?.toString() ?? 'Nhiệm vụ'),
                    subtitle: const Text('Đã hoàn thành'),
                    trailing: IconButton(
                      icon: const Icon(Icons.delete_outline),
                      onPressed: () => _deleteTask(task),
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Deadline'),
        actions: [
          IconButton(onPressed: _loadTasks, icon: const Icon(Icons.refresh)),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _busy ? null : () => _openTaskDialog(),
        icon: const Icon(Icons.add),
        label: const Text('Tạo nhiệm vụ'),
      ),
      body: body,
    );
  }
}

// ============================================================
// DOCUMENTS: private files and nested folders in Supabase
// ============================================================

class DocumentsScreen extends StatefulWidget {
  const DocumentsScreen({super.key});

  @override
  State<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends State<DocumentsScreen> {
  static const String _bucket = 'student-documents';
  List<Map<String, dynamic>> _items = [];
  final List<Map<String, dynamic>> _folderStack = [];
  bool _loading = true;
  bool _busy = false;
  String? _error;

  String? get _parentId =>
      _folderStack.isEmpty ? null : _folderStack.last['id'] as String;

  @override
  void initState() {
    super.initState();
    _loadItems();
  }

  Future<void> _loadItems() async {
    if (mounted) setState(() { _loading = true; _error = null; });
    try {
      final user = supabase.auth.currentUser;
      if (user == null) throw Exception('Bạn chưa đăng nhập.');
      var query = supabase.from('documents').select().eq('user_id', user.id);
      final data = _parentId == null
          ? await query.isFilter('parent_id', null).order('item_type').order('name')
          : await query.eq('parent_id', _parentId!).order('item_type').order('name');
      if (!mounted) return;
      setState(() => _items = List<Map<String, dynamic>>.from(data));
    } catch (e) {
      if (mounted) setState(() => _error = 'Không tải được tài liệu: $e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<String?> _askName({String title = 'Tên thư mục', String initial = ''}) async {
    final controller = TextEditingController(text: initial);
    return showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(hintText: 'Nhập tên'),
          onSubmitted: (_) => Navigator.pop(dialogContext, controller.text.trim()),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Hủy')),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, controller.text.trim()), child: const Text('Lưu')),
        ],
      ),
    );
  }

  Future<void> _createFolder() async {
    final name = await _askName();
    if (name == null || name.isEmpty) return;
    final user = supabase.auth.currentUser;
    if (user == null) return;
    try {
      setState(() => _busy = true);
      await supabase.from('documents').insert({
        'user_id': user.id,
        'name': name,
        'item_type': 'folder',
        'parent_id': _parentId,
      });
      await _loadItems();
    } catch (e) {
      _showMessage('Không tạo được thư mục: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _mimeType(String filename) {
    final ext = filename.contains('.') ? filename.split('.').last.toLowerCase() : '';
    const types = <String, String>{
      'pdf': 'application/pdf', 'png': 'image/png', 'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg', 'gif': 'image/gif', 'webp': 'image/webp',
      'ppt': 'application/vnd.ms-powerpoint',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'txt': 'text/plain', 'csv': 'text/csv', 'zip': 'application/zip',
      'mp3': 'audio/mpeg', 'mp4': 'video/mp4',
    };
    return types[ext] ?? 'application/octet-stream';
  }

  Future<void> _uploadFiles() async {
    try {
      final result = await FilePicker.platform.pickFiles(allowMultiple: true, withData: true);
      if (result == null || result.files.isEmpty) return;
      final user = supabase.auth.currentUser;
      if (user == null) throw Exception('Bạn chưa đăng nhập.');
      setState(() => _busy = true);
      for (final file in result.files) {
        final Uint8List? bytes = file.bytes;
        if (bytes == null) throw Exception('Không đọc được tệp ${file.name}. Hãy thử chọn lại.');
        final id = supabase.auth.currentUser!.id;
        // Keep Storage object keys ASCII-only. The original filename remains in
        // documents.name for display, while Storage uses a safe opaque name.
        final rawExtension = file.name.contains('.')
            ? file.name.split('.').last.toLowerCase()
            : '';
        final safeExtension = RegExp(r'^[a-z0-9]{1,10}$').hasMatch(rawExtension)
            ? rawExtension
            : 'bin';
        final storagePath =
            '$id/${DateTime.now().microsecondsSinceEpoch}.$safeExtension';
        await supabase.storage.from(_bucket).uploadBinary(
          storagePath, bytes,
          fileOptions: FileOptions(contentType: _mimeType(file.name), upsert: false),
        );
        try {
          await supabase.from('documents').insert({
            'user_id': user.id,
            'name': file.name,
            'item_type': 'file',
            'parent_id': _parentId,
            'storage_path': storagePath,
            'mime_type': _mimeType(file.name),
            'file_size': bytes.length,
          });
        } catch (_) {
          // Avoid leaving an orphaned Storage object if metadata insert fails.
          await supabase.storage.from(_bucket).remove([storagePath]);
          rethrow;
        }
      }
      await _loadItems();
      _showMessage('Đã tải lên ${result.files.length} tệp.');
    } catch (e) {
      _showMessage('Tải tệp thất bại: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _openFile(Map<String, dynamic> item) async {
    try {
      setState(() => _busy = true);
      final bytes = await supabase.storage.from(_bucket).download(item['storage_path'] as String);
      final dir = await getTemporaryDirectory();
      final safeName = (item['name'] as String).replaceAll(RegExp(r'[\\/:*?"<>|]'), '_');
      final file = File('${dir.path}/$safeName');
      await file.writeAsBytes(bytes, flush: true);
      final result = await OpenFilex.open(file.path);
      if (result.type != ResultType.done && mounted) {
        _showMessage('Không mở được tệp. Bạn hãy kiểm tra ứng dụng hỗ trợ định dạng này.');
      }
    } catch (e) {
      _showMessage('Không mở được tệp: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _rename(Map<String, dynamic> item) async {
    final name = await _askName(title: 'Đổi tên', initial: item['name'] as String);
    if (name == null || name.isEmpty || name == item['name']) return;
    try {
      setState(() => _busy = true);
      await supabase.from('documents').update({
        'name': name,
        'updated_at': DateTime.now().toIso8601String(),
      }).eq('id', item['id']).eq('user_id', supabase.auth.currentUser!.id);
      await _loadItems();
    } catch (e) {
      _showMessage('Đổi tên thất bại: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete(Map<String, dynamic> item) async {
    final isFolder = item['item_type'] == 'folder';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(isFolder ? 'Xóa thư mục?' : 'Xóa tệp?'),
        content: Text(isFolder
            ? 'Thư mục và toàn bộ nội dung bên trong sẽ bị xóa. Bạn không thể hoàn tác.'
            : 'Tệp này sẽ bị xóa khỏi tài liệu của bạn.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Hủy')),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Xóa')),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      setState(() => _busy = true);
      await _deleteItemRecursively(item);
      await _loadItems();
      _showMessage('Đã xóa.');
    } catch (e) {
      _showMessage('Xóa thất bại: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _deleteItemRecursively(Map<String, dynamic> item) async {
    final id = item['id'] as String;
    if (item['item_type'] == 'folder') {
      final children = await supabase.from('documents').select().eq('parent_id', id);
      for (final child in List<Map<String, dynamic>>.from(children)) {
        await _deleteItemRecursively(child);
      }
    } else {
      final path = item['storage_path'] as String?;
      if (path != null) await supabase.storage.from(_bucket).remove([path]);
    }
    await supabase.from('documents').delete()
        .eq('id', id).eq('user_id', supabase.auth.currentUser!.id);
  }

  void _showMessage(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  void _openFolder(Map<String, dynamic> folder) {
    setState(() => _folderStack.add(folder));
    _loadItems();
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Tài liệu'),
        actions: [
          IconButton(tooltip: 'Tạo thư mục', onPressed: _busy ? null : _createFolder,
              icon: const Icon(Icons.create_new_folder_outlined)),
          IconButton(tooltip: 'Tải tệp lên', onPressed: _busy ? null : _uploadFiles,
              icon: const Icon(Icons.upload_file_rounded)),
        ],
      ),
      body: Column(children: [
        if (_folderStack.isNotEmpty)
          SizedBox(
            height: 52,
            child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12), children: [
              TextButton.icon(
                onPressed: () { setState(() => _folderStack.clear()); _loadItems(); },
                icon: const Icon(Icons.home_outlined), label: const Text('Tài liệu'),
              ),
              for (var i = 0; i < _folderStack.length; i++) ...[
                const Icon(Icons.chevron_right, size: 18),
                TextButton(
                  onPressed: () { setState(() => _folderStack.removeRange(i + 1, _folderStack.length)); _loadItems(); },
                  child: Text(_folderStack[i]['name'] as String),
                ),
              ],
            ]),
          ),
        if (_busy) const LinearProgressIndicator(),
        Expanded(child: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error!, textAlign: TextAlign.center)))
              : _items.isEmpty
                  ? Center(child: Padding(
                      padding: const EdgeInsets.all(28),
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                        Icon(Icons.folder_open_rounded, size: 64, color: colors.onSurfaceVariant),
                        const SizedBox(height: 12),
                        const Text('Thư mục này chưa có tài liệu.', style: TextStyle(fontWeight: FontWeight.w600)),
                        const SizedBox(height: 6),
                        Text('Tạo thư mục hoặc tải tệp lên bằng các nút phía trên.', textAlign: TextAlign.center, style: TextStyle(color: colors.onSurfaceVariant)),
                      ]),
                    ))
                  : RefreshIndicator(
                      onRefresh: _loadItems,
                      child: ListView.separated(
                        padding: const EdgeInsets.fromLTRB(12, 8, 12, 24),
                        itemCount: _items.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 4),
                        itemBuilder: (context, index) {
                          final item = _items[index];
                          final folder = item['item_type'] == 'folder';
                          final name = item['name'] as String;
                          final size = item['file_size'] as int?;
                          return Card(
                            child: ListTile(
                              leading: Icon(folder ? Icons.folder_rounded : _iconForFile(name),
                                  color: folder ? Colors.amber.shade700 : colors.primary, size: 30),
                              title: Text(name, maxLines: 2, overflow: TextOverflow.ellipsis),
                              subtitle: folder ? const Text('Thư mục') : Text(_formatSize(size ?? 0)),
                              onTap: _busy ? null : () => folder ? _openFolder(item) : _openFile(item),
                              trailing: PopupMenuButton<String>(
                                enabled: !_busy,
                                onSelected: (value) {
                                  if (value == 'rename') _rename(item);
                                  if (value == 'delete') _delete(item);
                                  if (value == 'open' && !folder) _openFile(item);
                                },
                                itemBuilder: (_) => [
                                  if (!folder) const PopupMenuItem(value: 'open', child: Text('Mở tệp')),
                                  const PopupMenuItem(value: 'rename', child: Text('Đổi tên')),
                                  const PopupMenuItem(value: 'delete', child: Text('Xóa')),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                    )),
      ]),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _busy ? null : _uploadFiles,
        icon: const Icon(Icons.upload_rounded), label: const Text('Tải tệp lên'),
      ),
    );
  }

  IconData _iconForFile(String name) {
    final ext = name.contains('.') ? name.split('.').last.toLowerCase() : '';
    if (ext == 'pdf') return Icons.picture_as_pdf_rounded;
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].contains(ext)) return Icons.image_rounded;
    if (['ppt', 'pptx'].contains(ext)) return Icons.slideshow_rounded;
    if (['doc', 'docx', 'txt'].contains(ext)) return Icons.description_rounded;
    if (['xls', 'xlsx', 'csv'].contains(ext)) return Icons.table_chart_rounded;
    return Icons.insert_drive_file_rounded;
  }

  String _formatSize(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
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
                style: TextStyle(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
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
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
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
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                  fontSize: 13,
                ),
              ),
            ],
          ),
        ),
      );
    }

    if (checkedInClasses.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.check_circle_outline_rounded,
                size: 56,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
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
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
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
            color: Theme.of(context).cardColor,
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
                        color: Theme.of(context).colorScheme.surfaceContainerHighest,
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
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.onSurfaceVariant,
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
                              style: TextStyle(
                                color: Theme.of(context).colorScheme.onSurfaceVariant,
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
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        title: const Text('Check-in hôm nay'),
        backgroundColor: Theme.of(context).scaffoldBackgroundColor,
        surfaceTintColor: Colors.transparent,
      ),
      body: SafeArea(
        child: _buildContent(),
      ),
    );
  }
}

Future<String?> _getTodayOccurrenceId(String classSessionId) async {
  try {
    final result = await supabase.rpc(
      'get_today_occurrence',
      params: {
        'p_class_session_id': classSessionId,
      },
    );

    final occurrenceId = result?.toString();
    if (occurrenceId == null || occurrenceId.isEmpty) {
      return null;
    }

    return occurrenceId;
  } catch (e) {
    debugPrint('Get/create today occurrence error: $e');
    rethrow;
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

  var longestStreak =
      (row['longest_streak'] as num?)?.toInt() ?? 0;

  // The achievement RPC keeps the historical longest streak.
  // Also read the current streak from the leaderboard so streak
  // achievements unlock immediately when the current streak becomes
  // longer than the previously stored historical value.
  try {
    final leaderboardData = await supabase.rpc('get_leaderboard');
    if (leaderboardData is List) {
      for (final item in leaderboardData) {
        final leaderboardRow = Map<String, dynamic>.from(item as Map);
        if (leaderboardRow['user_id']?.toString() == user.id) {
          final currentStreak =
              (leaderboardRow['current_streak'] as num?)?.toInt() ?? 0;

          if (currentStreak > longestStreak) {
            longestStreak = currentStreak;
          }
          break;
        }
      }
    }
  } catch (e) {
    debugPrint('Load current streak for achievements error: $e');
  }

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
                color: Theme.of(context).colorScheme.surfaceContainerHighest,
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
                            color: Theme.of(context).colorScheme.onSurface,
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
                    style: TextStyle(
                      fontSize: 13,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 10),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: LinearProgressIndicator(
                      value: achievement.progressRatio,
                      minHeight: 7,
                      backgroundColor: Theme.of(context).colorScheme.surfaceContainerHighest,
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
                          : Theme.of(context).colorScheme.onSurfaceVariant,
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
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
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
  State<LeaderboardScreen> createState() => _LeaderboardScreenState();
}

class _LeaderboardScreenState extends State<LeaderboardScreen> {
  bool isLoading = true;
  String? errorMessage;
  List<Map<String, dynamic>> leaderboard = [];
  Map<String, dynamic>? myProfile;
  List<String> availableClasses = [];

  final ScrollController _scrollController = ScrollController();
  final Map<String, GlobalKey> _rowKeys = {};

  int currentPage = 1;
  static const int pageSize = 50;

  String _scope = 'all';
  String _metric = 'daily';
  String? _selectedClass;
  String? _highlightedUserId;

  bool get _isClassScope => _scope == 'class';

  int get totalPages =>
      leaderboard.isEmpty ? 1 : (leaderboard.length + pageSize - 1) ~/ pageSize;

  int get startIndex => (currentPage - 1) * pageSize;

  List<Map<String, dynamic>> get currentRows =>
      leaderboard.skip(startIndex).take(pageSize).toList();

  String get _metricLabel => _metric == 'weekly' ? 'streak tuần' : 'streak hiện tại';

  @override
  void initState() {
    super.initState();
    _loadInitial();
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _loadInitial() async {
    try {
      await _loadClasses();
    } catch (e) {
      debugPrint('Load classes error: $e');
    }
    await _loadLeaderboard();
  }

  Future<void> _loadClasses() async {
    // Không đọc trực tiếp users.class_name ở client vì RLS có thể chỉ cho
    // người dùng xem chính bản ghi của mình. Lấy danh sách lớp từ RPC
    // leaderboard (SECURITY DEFINER) để có toàn bộ lớp trong hệ thống.
    final data = await supabase.rpc(
      'get_leaderboard',
      params: {
        'p_scope': 'all',
        'p_class_name': null,
        'p_metric': 'daily',
      },
    );

    final classes = <String>{};
    String userClass = '';
    final currentUserId = supabase.auth.currentUser?.id;

    for (final rawRow in (data as List)) {
      final row = Map<String, dynamic>.from(rawRow as Map);
      final value = row['class_name']?.toString().trim() ?? '';
      if (value.isNotEmpty) classes.add(value);

      if (currentUserId != null &&
          row['user_id']?.toString() == currentUserId) {
        userClass = value;
      }
    }

    final sortedClasses = classes.toList()..sort((a, b) => a.compareTo(b));

    if (!mounted) return;
    setState(() {
      availableClasses = sortedClasses;
      if (_selectedClass == null && availableClasses.isNotEmpty) {
        _selectedClass = availableClasses.contains(userClass)
            ? userClass
            : availableClasses.first;
      }
    });
  }

  Future<void> _loadLeaderboard() async {
    try {
      if (mounted) {
        setState(() {
          isLoading = true;
          errorMessage = null;
          _highlightedUserId = null;
        });
      }

      final data = await supabase.rpc(
        'get_leaderboard',
        params: {
          'p_scope': _scope,
          'p_class_name': _isClassScope ? _selectedClass : null,
          'p_metric': _metric,
        },
      );

      final rows = (data as List)
          .map((row) => Map<String, dynamic>.from(row as Map))
          .toList();

      // Production RPC đã trả rank theo đúng scope. Sort lại theo rank để
      // UI luôn giữ đúng thứ tự kể cả khi backend trả về khác thứ tự.
      rows.sort((a, b) {
        final ar = (a['rank'] as num?)?.toInt();
        final br = (b['rank'] as num?)?.toInt();
        if (ar != null && br != null && ar != br) return ar.compareTo(br);

        final av = _metricValue(a);
        final bv = _metricValue(b);
        if (bv != av) return bv.compareTo(av);

        final ac = _totalCheckIns(a);
        final bc = _totalCheckIns(b);
        if (bc != ac) return bc.compareTo(ac);
        return _displayName(a).toLowerCase().compareTo(
              _displayName(b).toLowerCase(),
            );
      });

      final user = supabase.auth.currentUser;
      Map<String, dynamic>? profile;
      if (user != null) {
        final userData = await supabase
            .from('users')
            .select('student_code, name, email, class_name')
            .eq('id', user.id)
            .maybeSingle();
        final profileData = await supabase
            .from('profiles')
            .select('display_name, avatar_url')
            .eq('id', user.id)
            .maybeSingle();
        profile = {
          if (userData != null) ...Map<String, dynamic>.from(userData),
          if (profileData != null) ...Map<String, dynamic>.from(profileData),
          'email': userData?['email'] ?? user.email ?? '',
        };
      }

      if (!mounted) return;
      setState(() {
        leaderboard = rows;
        myProfile = profile;
        currentPage = 1;
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

  int _metricValue(Map<String, dynamic> row) {
    return _metric == 'weekly'
        ? ((row['weekly_streak'] as num?)?.toInt() ?? 0)
        : ((row['current_streak'] as num?)?.toInt() ?? 0);
  }

  String _displayName(Map<String, dynamic> row) {
    final value = row['display_name']?.toString().trim();
    return value == null || value.isEmpty ? 'Sinh viên' : value;
  }

  String _avatarUrl(Map<String, dynamic> row) {
    return row['avatar_url']?.toString().trim() ?? '';
  }

  String _studentCode(Map<String, dynamic> row) {
    final value = row['student_code']?.toString().trim();
    return value == null || value.isEmpty ? 'Chưa có MSSV' : value;
  }

  String _className(Map<String, dynamic> row) {
    final value = row['class_name']?.toString().trim();
    return value == null || value.isEmpty ? 'Chưa có lớp' : value;
  }

  int _streak(Map<String, dynamic> row) =>
      (row['current_streak'] as num?)?.toInt() ?? 0;

  int _weeklyStreak(Map<String, dynamic> row) =>
      (row['weekly_streak'] as num?)?.toInt() ?? 0;

  int _totalCheckIns(Map<String, dynamic> row) =>
      (row['total_check_ins'] as num?)?.toInt() ?? 0;

  String _userId(Map<String, dynamic> row) => row['user_id']?.toString() ?? '';

  Widget _avatar(Map<String, dynamic> row, {double radius = 22}) {
    final url = _avatarUrl(row);
    return CircleAvatar(
      radius: radius,
      backgroundImage: url.isNotEmpty ? NetworkImage(url) : null,
      child: url.isEmpty ? Icon(Icons.person, size: radius) : null,
    );
  }

  int _rankOf(Map<String, dynamic> row) {
    final backendRank = (row['rank'] as num?)?.toInt();
    if (backendRank != null && backendRank > 0) return backendRank;

    final userId = _userId(row);
    final index = leaderboard.indexWhere((r) => _userId(r) == userId);
    return index < 0 ? 0 : index + 1;
  }

  Map<String, dynamic>? get _meRow {
    final id = supabase.auth.currentUser?.id;
    if (id == null) return null;
    for (final row in leaderboard) {
      if (_userId(row) == id) return row;
    }
    return null;
  }

  void _showStudentDetails(Map<String, dynamic> row) {
    final rank = _rankOf(row);
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) {
        return SafeArea(
          child: Container(
            constraints: const BoxConstraints(maxHeight: 620),
            margin: const EdgeInsets.fromLTRB(12, 0, 12, 12),
            padding: const EdgeInsets.fromLTRB(22, 22, 22, 24),
            decoration: BoxDecoration(
              color: theme.cardColor,
              borderRadius: BorderRadius.circular(28),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.18),
                  blurRadius: 24,
                  offset: const Offset(0, -6),
                ),
              ],
            ),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 42,
                    height: 4,
                    margin: const EdgeInsets.only(bottom: 18),
                    decoration: BoxDecoration(
                      color: theme.dividerColor,
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),
                  _avatar(row, radius: 52),
                  const SizedBox(height: 14),
                  Text(
                    _displayName(row),
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 23,
                      fontWeight: FontWeight.w800,
                      color: colorScheme.onSurface,
                    ),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    'Hạng #$rank',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: colorScheme.primary,
                    ),
                  ),
                  const SizedBox(height: 22),
                  Row(
                    children: [
                      Expanded(
                        child: _detailStatCard(
                          icon: Icons.local_fire_department_rounded,
                          label: 'Streak ngày',
                          value: '${_streak(row)} ngày',
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _detailStatCard(
                          icon: Icons.calendar_view_week_rounded,
                          label: 'Streak tuần',
                          value: '${_weeklyStreak(row)} tuần',
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  _detailStatCard(
                    icon: Icons.check_circle_outline_rounded,
                    label: 'Tổng check-in',
                    value: '${_totalCheckIns(row)} lần',
                  ),
                  const SizedBox(height: 12),
                  _detailInfoTile(
                    icon: Icons.school_outlined,
                    label: 'Lớp',
                    value: _className(row),
                  ),
                  const SizedBox(height: 10),
                  _detailInfoTile(
                    icon: Icons.badge_outlined,
                    label: 'MSSV',
                    value: _studentCode(row),
                  ),
                  const SizedBox(height: 18),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: () => Navigator.pop(sheetContext),
                      child: const Text('Đóng'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _detailStatCard({
    required IconData icon,
    required String label,
    required String value,
  }) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      decoration: BoxDecoration(
        color: colorScheme.primary.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        children: [
          Icon(icon, color: colorScheme.primary, size: 25),
          const SizedBox(height: 6),
          Text(
            value,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w800,
              color: colorScheme.onSurface,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              color: colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }

  Widget _detailInfoTile({
    required IconData icon,
    required String label,
    required String value,
  }) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.45),
        borderRadius: BorderRadius.circular(15),
      ),
      child: Row(
        children: [
          Icon(icon, color: colorScheme.primary, size: 23),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 11,
                    color: colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: colorScheme.onSurface,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPodiumCard({
    required Map<String, dynamic> row,
    required int rank,
  }) {
    return Expanded(
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: () => _showStudentDetails(row),
          child: Container(
            margin: EdgeInsets.only(
              left: rank == 1 ? 6 : 4,
              right: rank == 3 ? 6 : 4,
              top: rank == 1 ? 0 : 28,
            ),
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 14),
            decoration: BoxDecoration(
              color: Theme.of(context).cardColor,
              borderRadius: BorderRadius.circular(18),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.06),
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
                    color: Theme.of(context).colorScheme.primary,
                  ),
                ),
                const SizedBox(height: 8),
                _avatar(row, radius: rank == 1 ? 34 : 28),
                const SizedBox(height: 8),
                Text(
                  _displayName(row),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                ),
                const SizedBox(height: 3),
                Text(
                  _className(row),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 10,
                    color: Theme.of(context).textTheme.bodySmall?.color,
                  ),
                ),
                Text(
                  _studentCode(row),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 10,
                    color: Theme.of(context).textTheme.bodySmall?.color,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  _metric == 'weekly'
                      ? '📅 ${_weeklyStreak(row)} tuần'
                      : '🔥 ${_streak(row)} ngày',
                  style: TextStyle(
                    fontSize: 12,
                    color: Theme.of(context).textTheme.bodySmall?.color,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _scrollByPage(int delta) {
    final target = (currentPage + delta).clamp(1, totalPages);
    if (target == currentPage) return;
    setState(() => currentPage = target);
    _scrollController.animateTo(
      0,
      duration: const Duration(milliseconds: 250),
      curve: Curves.easeOut,
    );
  }

  Future<void> _jumpToMe() async {
    final me = _meRow;
    if (me == null) return;

    final rank = _rankOf(me);
    final page = ((rank - 1) ~/ pageSize) + 1;
    final id = _userId(me);

    setState(() {
      currentPage = page;
      _highlightedUserId = id;
    });

    // Chờ frame mới để row của trang đích được build, sau đó cuộn đúng tới
    // card của mình thay vì chỉ nhảy lên đầu trang.
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final key = _rowKeys[id];
      final targetContext = key?.currentContext;
      if (targetContext != null && mounted) {
        await Scrollable.ensureVisible(
          targetContext,
          duration: const Duration(milliseconds: 700),
          curve: Curves.easeInOutCubic,
          alignment: 0.35,
        );
      }

      if (!mounted) return;
      await Future.delayed(const Duration(milliseconds: 1200));
      if (mounted && _highlightedUserId == id) {
        setState(() => _highlightedUserId = null);
      }
    });
  }

  void _fastScroll() {
    if (!_scrollController.hasClients) return;
    final max = _scrollController.position.maxScrollExtent;
    final next = (_scrollController.offset +
            MediaQuery.of(context).size.height * 1.8)
        .clamp(0.0, max);
    _scrollController.animateTo(
      next,
      duration: const Duration(milliseconds: 350),
      curve: Curves.easeOut,
    );
  }

  Widget _buildRow(Map<String, dynamic> row) {
    final rank = _rankOf(row);
    final me = _userId(row) == supabase.auth.currentUser?.id;
    final highlighted = _highlightedUserId == _userId(row);
    final colorScheme = Theme.of(context).colorScheme;
    final key = _rowKeys.putIfAbsent(_userId(row), () => GlobalKey());

    return Container(
      key: key,
      margin: const EdgeInsets.only(bottom: 9),
      child: AnimatedScale(
        scale: highlighted ? 1.018 : 1.0,
        duration: const Duration(milliseconds: 260),
        curve: Curves.easeOutBack,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 260),
          curve: Curves.easeOut,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: highlighted
                  ? colorScheme.primary
                  : Colors.transparent,
              width: highlighted ? 2 : 0,
            ),
            boxShadow: highlighted
                ? [
                    BoxShadow(
                      color: colorScheme.primary.withValues(alpha: 0.38),
                      blurRadius: 22,
                      spreadRadius: 2,
                    ),
                  ]
                : const [],
          ),
          child: Card(
            elevation: highlighted ? 5 : 0,
            margin: EdgeInsets.zero,
            child: ListTile(
              onTap: () => _showStudentDetails(row),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 12,
                vertical: 4,
              ),
              leading: SizedBox(
                width: 40,
                child: Text(
                  '#$rank',
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
              ),
              title: Row(
                children: [
                  _avatar(row, radius: 20),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      _displayName(row),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontWeight: me ? FontWeight.w800 : FontWeight.w600,
                      ),
                    ),
                  ),
                  if (me)
                    const Chip(
                      label: Text('Bạn', style: TextStyle(fontSize: 10)),
                      visualDensity: VisualDensity.compact,
                    ),
                ],
              ),
              subtitle: Padding(
                padding: const EdgeInsets.only(left: 50, top: 3),
                child: Text(
                  '${_className(row)} • ${_studentCode(row)} • ${_totalCheckIns(row)} check-in',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              trailing: Text(
                _metric == 'weekly'
                    ? '📅 ${_weeklyStreak(row)}'
                    : '🔥 ${_streak(row)}',
                style: const TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 15,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildScopeToggle() {
    final colorScheme = Theme.of(context).colorScheme;

    return Container(
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.42),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: colorScheme.outline.withValues(alpha: 0.22),
        ),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: _buildFilterChoice(
                  label: 'Chung',
                  icon: Icons.public_rounded,
                  selected: !_isClassScope,
                  onTap: () {
                    if (_scope == 'all') return;
                    setState(() {
                      _scope = 'all';
                      currentPage = 1;
                      _highlightedUserId = null;
                    });
                    _loadLeaderboard();
                  },
                ),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: _buildFilterChoice(
                  label: 'Theo lớp',
                  icon: Icons.school_rounded,
                  selected: _isClassScope,
                  onTap: () {
                    if (_scope == 'class') return;
                    setState(() {
                      _scope = 'class';
                      currentPage = 1;
                      _highlightedUserId = null;
                      if (_selectedClass == null && availableClasses.isNotEmpty) {
                        _selectedClass = availableClasses.first;
                      }
                    });
                    _loadLeaderboard();
                  },
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: _buildFilterChoice(
                  label: 'Ngày',
                  icon: Icons.local_fire_department_rounded,
                  selected: _metric == 'daily',
                  onTap: () {
                    if (_metric == 'daily') return;
                    setState(() {
                      _metric = 'daily';
                      currentPage = 1;
                      _highlightedUserId = null;
                    });
                    _loadLeaderboard();
                  },
                ),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: _buildFilterChoice(
                  label: 'Tuần',
                  icon: Icons.calendar_view_week_rounded,
                  selected: _metric == 'weekly',
                  onTap: () {
                    if (_metric == 'weekly') return;
                    setState(() {
                      _metric = 'weekly';
                      currentPage = 1;
                      _highlightedUserId = null;
                    });
                    _loadLeaderboard();
                  },
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildFilterChoice({
    required String label,
    required IconData icon,
    required bool selected,
    required VoidCallback onTap,
  }) {
    final colorScheme = Theme.of(context).colorScheme;

    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(15),
      child: InkWell(
        borderRadius: BorderRadius.circular(15),
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          height: 50,
          decoration: BoxDecoration(
            color: selected
                ? colorScheme.primary.withValues(alpha: 0.20)
                : Colors.transparent,
            borderRadius: BorderRadius.circular(15),
            border: Border.all(
              color: selected
                  ? colorScheme.primary.withValues(alpha: 0.38)
                  : Colors.transparent,
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                icon,
                size: 21,
                color: selected
                    ? colorScheme.primary
                    : colorScheme.onSurfaceVariant,
              ),
              const SizedBox(width: 8),
              Text(
                label,
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
                  color: selected
                      ? colorScheme.primary
                      : colorScheme.onSurface,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildClassPicker() {
    if (!_isClassScope) return const SizedBox.shrink();

    final current = availableClasses.contains(_selectedClass)
        ? _selectedClass
        : (availableClasses.isNotEmpty ? availableClasses.first : null);

    if (current != _selectedClass && current != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _selectedClass != current) {
          setState(() => _selectedClass = current);
          _loadLeaderboard();
        }
      });
    }

    final colorScheme = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: DropdownButtonFormField<String>(
        value: current,
        isExpanded: true,
        menuMaxHeight: 360,
        icon: const Icon(Icons.keyboard_arrow_down_rounded),
        decoration: InputDecoration(
          labelText: 'Lớp đang xem',
          hintText: availableClasses.isEmpty ? 'Chưa có dữ liệu lớp' : null,
          prefixIcon: const Icon(Icons.school_rounded),
          filled: true,
          fillColor: colorScheme.surfaceContainerHighest.withValues(alpha: 0.55),
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 15,
          ),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(16),
            borderSide: BorderSide.none,
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(16),
            borderSide: BorderSide(
              color: colorScheme.outline.withValues(alpha: 0.16),
            ),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(16),
            borderSide: BorderSide(
              color: colorScheme.primary.withValues(alpha: 0.65),
              width: 1.5,
            ),
          ),
        ),
        items: availableClasses
            .map(
              (className) => DropdownMenuItem<String>(
                value: className,
                child: Text(
                  className,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ),
            )
            .toList(),
        onChanged: availableClasses.isEmpty
            ? null
            : (value) {
                if (value == null || value == _selectedClass) return;
                setState(() {
                  _selectedClass = value;
                  currentPage = 1;
                  _highlightedUserId = null;
                });
                _loadLeaderboard();
              },
      ),
    );
  }

  Widget _buildMyCard() {
    final me = _meRow;
    final rank = me == null ? null : _rankOf(me);
    final profile = myProfile ?? {};
    final name = profile['display_name']?.toString().trim().isNotEmpty == true
        ? profile['display_name'].toString()
        : (profile['name']?.toString() ?? 'Bạn');
    final email = profile['email']?.toString() ??
        supabase.auth.currentUser?.email ??
        'Chưa có email';
    final code = profile['student_code']?.toString().trim().isNotEmpty == true
        ? profile['student_code'].toString()
        : 'Chưa có MSSV';
    final cls = profile['class_name']?.toString().trim().isNotEmpty == true
        ? profile['class_name'].toString()
        : 'Chưa có lớp';
    final inSelectedClass = me != null;

    return Card(
      elevation: inSelectedClass ? 5 : 2,
      margin: const EdgeInsets.only(top: 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            _avatar(me ?? profile, radius: 25),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 15,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    inSelectedClass
                        ? 'Hạng $rank • ${_totalCheckIns(me)} check-in • '
                            '${_metric == 'weekly' ? '📅 ${_weeklyStreak(me)} tuần' : '🔥 ${_streak(me)} ngày'}'
                        : 'Không thuộc lớp đang xem • $code • $cls',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '$code • $cls',
                    style: const TextStyle(fontSize: 11),
                  ),
                  Text(
                    email,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11),
                  ),
                ],
              ),
            ),
            IconButton(
              tooltip: inSelectedClass
                  ? 'Định vị tôi trên bảng xếp hạng'
                  : 'Bạn không thuộc lớp đang xem',
              onPressed: inSelectedClass ? _jumpToMe : null,
              icon: Icon(
                Icons.my_location_rounded,
                color: inSelectedClass
                    ? Theme.of(context).colorScheme.primary
                    : null,
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final rows = currentRows;
    final showPodium = currentPage == 1 && rows.length >= 3;

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        title: const Text(
          'Xếp hạng',
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
        backgroundColor: Colors.transparent,
      ),
      body: Column(
        children: [
          Expanded(
            child: RefreshIndicator(
              onRefresh: _loadLeaderboard,
              child: isLoading
                  ? ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      children: const [
                        SizedBox(
                          height: 420,
                          child: Center(child: CircularProgressIndicator()),
                        ),
                      ],
                    )
                  : errorMessage != null
                      ? ListView(
                          physics: const AlwaysScrollableScrollPhysics(),
                          padding: const EdgeInsets.all(24),
                          children: [
                            const SizedBox(height: 100),
                            const Icon(Icons.error_outline, size: 48, color: Colors.red),
                            const SizedBox(height: 16),
                            const Text(
                              'Không thể tải bảng xếp hạng.',
                              textAlign: TextAlign.center,
                              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                            ),
                            const SizedBox(height: 10),
                            Text(errorMessage!, textAlign: TextAlign.center),
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
                                  height: 320,
                                  child: Center(child: Text('Chưa có dữ liệu xếp hạng.')),
                                ),
                              ],
                            )
                          : Stack(
                              children: [
                                ListView(
                                  controller: _scrollController,
                                  physics: const AlwaysScrollableScrollPhysics(),
                                  padding: const EdgeInsets.fromLTRB(16, 10, 16, 18),
                                  children: [
                                    _buildScopeToggle(),
                                    _buildClassPicker(),
                                    const SizedBox(height: 18),
                                    const Text(
                                      'Leaderboard',
                                      style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      _isClassScope
                                          ? '${_selectedClass ?? 'Chưa chọn lớp'} • $_metricLabel • ${leaderboard.length} sinh viên • tối đa $pageSize người/trang'
                                          : 'Chung • $_metricLabel • ${leaderboard.length} sinh viên • tối đa $pageSize người/trang',
                                      style: TextStyle(
                                        color: Theme.of(context).textTheme.bodySmall?.color,
                                        fontSize: 13,
                                      ),
                                    ),
                                    const SizedBox(height: 18),
                                    if (showPodium)
                                      Row(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          _buildPodiumCard(row: rows[1], rank: 2),
                                          _buildPodiumCard(row: rows[0], rank: 1),
                                          _buildPodiumCard(row: rows[2], rank: 3),
                                        ],
                                      ),
                                    if (showPodium) const SizedBox(height: 22),
                                    ...rows.map(_buildRow),
                                    const SizedBox(height: 12),
                                    Row(
                                      mainAxisAlignment: MainAxisAlignment.center,
                                      children: [
                                        IconButton(
                                          tooltip: 'Trang trước',
                                          onPressed: currentPage > 1
                                              ? () => _scrollByPage(-1)
                                              : null,
                                          icon: const Icon(Icons.chevron_left_rounded),
                                        ),
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                                          decoration: BoxDecoration(
                                            color: Theme.of(context)
                                                .colorScheme
                                                .primary
                                                .withValues(alpha: 0.08),
                                            borderRadius: BorderRadius.circular(12),
                                          ),
                                          child: Text(
                                            '$currentPage / $totalPages',
                                            style: const TextStyle(fontWeight: FontWeight.w800),
                                          ),
                                        ),
                                        IconButton(
                                          tooltip: 'Trang sau',
                                          onPressed: currentPage < totalPages
                                              ? () => _scrollByPage(1)
                                              : null,
                                          icon: const Icon(Icons.chevron_right_rounded),
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                                Positioned(
                                  right: 6,
                                  top: 0,
                                  bottom: 0,
                                  child: Center(
                                    child: FloatingActionButton.small(
                                      heroTag: 'fast_rank_scroll',
                                      tooltip: 'Cuộn nhanh',
                                      onPressed: _fastScroll,
                                      child: const Icon(Icons.keyboard_double_arrow_down_rounded),
                                    ),
                                  ),
                                ),
                              ],
                            ),
            ),
          ),
          SafeArea(
            top: false,
            child: SizedBox(
              height: 142,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
                child: _buildMyCard(),
              ),
            ),
          ),
        ],
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
                      Text(
                        'Copy nguyên bảng lịch học từ trang sinh viên rồi dán vào đây. App sẽ tự nhận diện mã môn, thứ, tiết, phòng và giảng viên.',
                        style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
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
                final scheduleChanged =
                    editing.subject.trim() != subjectName.trim() ||
                    editing.room.trim() != subjectRoom.trim() ||
                    editing.startTime != startTime ||
                    editing.endTime != endTime ||
                    editing.dayOfWeek != day ||
                    editing.teacher.trim() != subjectTeacher.trim();

                if (scheduleChanged) {
                  // Không sửa đè class_session cũ. Lịch cũ có thể đã có
                  // occurrence/check-in lịch sử, nên phải giữ nguyên nó.
                  // Tạo class_session mới cho lịch mới và soft-delete lịch cũ.
                  await supabase
                      .from('class_sessions')
                      .update({'is_active': false})
                      .eq('id', editing.id)
                      .eq('user_id', user.id);

                  if (!reactivatedExisting) {
                    await supabase.from('class_sessions').insert({
                      'user_id': user.id,
                      ...payload,
                      'is_active': true,
                    });
                  }
                } else {
                  // Chỉ cập nhật metadata khi lịch thực tế không thay đổi.
                  await supabase
                      .from('class_sessions')
                      .update({
                        'teacher': subjectTeacher.isEmpty ? null : subjectTeacher,
                        'is_active': true,
                      })
                      .eq('id', editing.id)
                      .eq('user_id', user.id);
                }
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

  Future<void> _clearAllSchedule() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Xóa toàn bộ lịch học?'),
        content: const Text(
          'Tất cả lịch học hiện tại sẽ được đưa về trạng thái trống. Lịch sử check-in đã có vẫn được giữ lại và bạn có thể nhập/thêm lịch mới sau đó.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Hủy'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Xóa tất cả'),
          ),
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
          .eq('user_id', user.id)
          .eq('is_active', true);

      await NotificationService.syncSchedule(const []);
      await _loadClasses();

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Đã xóa toàn bộ lịch học. Lịch sử check-in vẫn được giữ lại.')),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Không thể xóa toàn bộ lịch học.\n$e')),
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
          Theme.of(context).scaffoldBackgroundColor,

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
            tooltip: 'Xóa toàn bộ lịch học',
            onPressed: classes.isEmpty ? null : _clearAllSchedule,
            icon: const Icon(Icons.delete_outline_rounded),
          ),
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
                      color: Theme.of(context).cardColor,
                      borderRadius:
                          BorderRadius.circular(
                        20,
                      ),
                    ),

                    child: Row(
                      children: [
                        const Icon(
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
                                  Theme.of(context).colorScheme.onSurfaceVariant,
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
          color: Theme.of(context).cardColor,
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
                    Theme.of(context).colorScheme.surfaceContainerHighest,
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
                        TextStyle(
                      color:
                          Theme.of(context).colorScheme.onSurfaceVariant,
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
        decoration: BoxDecoration(color: Theme.of(context).cardColor, borderRadius: BorderRadius.circular(20)),
        child: Row(
        children: [
          Container(
            width: 60,
            padding: const EdgeInsets.symmetric(vertical: 10),
            decoration: BoxDecoration(color: Theme.of(context).colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(14)),
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
                    decoration: BoxDecoration(color: Theme.of(context).colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(10)),
                    child: Text('Không Check-in', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: Theme.of(context).colorScheme.onSurfaceVariant)),
                  ),
              ]),
              const SizedBox(height: 6),
              Text(classSession.time, style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
              const SizedBox(height: 4),
              Text('Phòng ${classSession.room}', style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
              if (classSession.teacher.trim().isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(classSession.teacher, style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant, fontSize: 13)),
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
          Theme.of(context).colorScheme.surfaceContainerHighest,

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
                color: Theme.of(context).cardColor,
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
                          Theme.of(context).colorScheme.surfaceContainerHighest,
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
                        TextStyle(
                      fontSize: 16,
                      color:
                          Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),

                  const SizedBox(height: 6),

                  Text(
                    'Phòng ${classSession.room}',
                    style:
                        TextStyle(
                      fontSize: 16,
                      color:
                          Theme.of(context).colorScheme.onSurfaceVariant,
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
                color: Theme.of(context).cardColor,
                borderRadius:
                    BorderRadius.circular(20),
              ),

              child: Column(
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
                          Theme.of(context).colorScheme.onSurfaceVariant,
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
                        color: Theme.of(context).colorScheme.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(
                            Icons.info_outline_rounded,
                            color: Theme.of(context).colorScheme.onSurfaceVariant,
                          ),
                          const SizedBox(width: 9),
                          Text(
                            'Môn này không tính Check-in',
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.onSurfaceVariant,
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
                        color: Colors.green.withValues(alpha: 0.10),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(
                          color: Colors.green.withValues(alpha: 0.30),
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
          color: Theme.of(context).cardColor,
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
                          .withValues(alpha: 0.65),
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

      // Show failure feedback only when AI returned a negative verification.
      if (!verified && mounted) {
        debugPrint('SHOW CHECK-IN FAILURE MEME: AI verification returned false');
        try {
          await MemeFeedback.show(
            context,
            MemeFeedbackType.checkinFailure,
          );
        } catch (feedbackError, feedbackStackTrace) {
          debugPrint('CHECK-IN FAILURE MEME ERROR: $feedbackError');
          debugPrint('$feedbackStackTrace');
        }
      }
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

      // If the image was uploaded, an exception happened during/after the
      // verification request (for example Gemini/Edge Function 502). Do not
      // show this meme for local image or upload failures.
      if (uploadedImagePath != null && mounted) {
        debugPrint('SHOW CHECK-IN FAILURE MEME: verification request threw an error');
        try {
          await MemeFeedback.show(
            context,
            MemeFeedbackType.checkinFailure,
          );
        } catch (feedbackError, feedbackStackTrace) {
          debugPrint('CHECK-IN FAILURE MEME ERROR: $feedbackError');
          debugPrint('$feedbackStackTrace');
        }
      }
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
          .select('id, occurrence_id')
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

      // Repair old check-ins that were saved before occurrence_id was used.
      if (existing != null) {
        if (existing['occurrence_id'] == null) {
          final occurrenceId =
              await _getTodayOccurrenceId(widget.classSession.id);

          if (occurrenceId == null) {
            throw Exception(
              'Không tìm thấy buổi học hôm nay trong hệ thống. Vui lòng tải lại lịch học rồi thử lại.',
            );
          }

          await supabase
              .from('check_ins')
              .update({'occurrence_id': occurrenceId})
              .eq('id', existing['id']);

          debugPrint(
            'REPAIRED CHECK-IN ${existing['id']} -> occurrence $occurrenceId',
          );
        }

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

      // Every new streakable check-in must point to today's occurrence.
      final occurrenceId =
          await _getTodayOccurrenceId(widget.classSession.id);

      if (occurrenceId == null) {
        throw Exception(
          'Không tìm thấy buổi học hôm nay trong hệ thống. Vui lòng tải lại lịch học rồi thử lại.',
        );
      }

      // ========================================================
      // INSERT CHECK-IN SAU KHI AI ĐÃ VERIFY
      // ========================================================

      debugPrint('INSERTING VERIFIED CHECK-IN...');

      await supabase.from('check_ins').insert({
        'user_id': user.id,
        'class_session_id': widget.classSession.id,
        'occurrence_id': occurrenceId,
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
    final colors = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
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
                          ? (isDark ? Colors.green.shade900.withValues(alpha: 0.35) : Colors.green.shade50)
                          : errorMessage != null
                              ? (isDark ? Colors.red.shade900.withValues(alpha: 0.35) : Colors.red.shade50)
                              : (isDark ? colors.primaryContainer : Colors.blue.shade50),
                    ),
                    child: Icon(
                      isSuccess
                          ? Icons.check_circle
                          : errorMessage != null
                              ? Icons.error_outline
                              : Icons.location_searching,
                      size: 64,
                      color: isSuccess
                          ? Colors.green.shade600
                          : errorMessage != null
                              ? Colors.red.shade600
                              : colors.primary,
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
                      color: colors.onSurfaceVariant,
                    ),
                  ),

                  const SizedBox(height: 28),

                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      color: Theme.of(context).cardColor,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: colors.outline.withValues(alpha: 0.35),
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
    final colors = Theme.of(context).colorScheme;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          icon,
          size: 22,
          color: colors.primary,
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
                  color: colors.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                value,
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: colors.onSurface,
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

class CheckInSuccessScreen extends StatefulWidget {
  final ClassSession classSession;
  final bool alreadyCheckedIn;

  const CheckInSuccessScreen({
    super.key,
    required this.classSession,
    required this.alreadyCheckedIn,
  });

  @override
  State<CheckInSuccessScreen> createState() => _CheckInSuccessScreenState();
}

class _CheckInSuccessScreenState extends State<CheckInSuccessScreen> {
  @override
  void initState() {
    super.initState();
    // Show celebratory meme only for a newly recorded check-in.
    // Existing check-ins must not replay success feedback.
    if (!widget.alreadyCheckedIn) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          MemeFeedback.show(context, MemeFeedbackType.checkinSuccess);
        }
      });
    }
  }

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
                widget.alreadyCheckedIn
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
                widget.classSession.subject,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 18),
              ),
              const SizedBox(height: 8),
              Text(
                'Phòng ${widget.classSession.room}',
                style: const TextStyle(fontSize: 16),
              ),
              const SizedBox(height: 32),
              ElevatedButton(
                onPressed: () {
                  Navigator.popUntil(
                    context,
                    (route) => route.isFirst,
                  );
                },
                child: const Text('Về trang chủ'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
