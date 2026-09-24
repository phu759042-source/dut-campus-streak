import 'dart:io';

import 'package:flutter/material.dart';
import 'package:camera/camera.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Supabase.initialize(
    url: 'https://gmwurbvhhzgdikogxiqb.supabase.co',
    anonKey: 'sb_publishable_i7IHac8LyrXoG3aiLDlS7A_1Vua8h8l',
  );

  runApp(const DUTCampusStreakApp());
}

final supabase = Supabase.instance.client;

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
      home: const LoginScreen(),
    );
  }
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
    this.completed = false,
  });

  String get time => '$startTime – $endTime';

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
    );
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
  String? _errorMessage;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

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

      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (_) => const HomeScreen(),
        ),
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
    return Scaffold(
      backgroundColor: const Color(0xFFEAF4FF),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              children: [
                Container(
                  width: 90,
                  height: 90,
                  decoration: BoxDecoration(
                    color: const Color(0xFF005BAC),
                    borderRadius:
                        BorderRadius.circular(24),
                  ),
                  child: const Icon(
                    Icons.school_rounded,
                    color: Colors.white,
                    size: 48,
                  ),
                ),

                const SizedBox(height: 24),

                const Text(
                  'DUT Campus Streak',
                  style: TextStyle(
                    fontSize: 28,
                    fontWeight: FontWeight.bold,
                    color: Color(0xFF005BAC),
                  ),
                ),

                const SizedBox(height: 8),

                const Text(
                  'Học đều mỗi ngày – Giữ vững streak',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 15,
                    color: Colors.black54,
                  ),
                ),

                const SizedBox(height: 40),

                Container(
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius:
                        BorderRadius.circular(24),
                    boxShadow: [
                      BoxShadow(
                        color:
                            Colors.black.withOpacity(0.08),
                        blurRadius: 20,
                        offset: const Offset(0, 8),
                      ),
                    ],
                  ),
                  child: Column(
                    crossAxisAlignment:
                        CrossAxisAlignment.stretch,
                    children: [
                      const Text(
                        'Đăng nhập',
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.bold,
                        ),
                      ),

                      const SizedBox(height: 20),

                      TextField(
                        controller: _emailController,
                        keyboardType:
                            TextInputType.emailAddress,
                        decoration: InputDecoration(
                          labelText: 'Email',
                          hintText:
                              'phu759042@gmail.com',
                          prefixIcon: const Icon(
                            Icons.email_outlined,
                          ),
                          border: OutlineInputBorder(
                            borderRadius:
                                BorderRadius.circular(14),
                          ),
                        ),
                      ),

                      const SizedBox(height: 16),

                      TextField(
                        controller:
                            _passwordController,
                        obscureText: true,
                        decoration: InputDecoration(
                          labelText: 'Mật khẩu',
                          prefixIcon: const Icon(
                            Icons.lock_outline,
                          ),
                          border: OutlineInputBorder(
                            borderRadius:
                                BorderRadius.circular(14),
                          ),
                        ),
                      ),

                      const SizedBox(height: 16),

                      if (_errorMessage != null)
                        Container(
                          padding:
                              const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: Colors.red
                                .withOpacity(0.08),
                            borderRadius:
                                BorderRadius.circular(12),
                          ),
                          child: Text(
                            _errorMessage!,
                            style: const TextStyle(
                              color: Colors.red,
                              fontSize: 13,
                            ),
                          ),
                        ),

                      const SizedBox(height: 24),

                      SizedBox(
                        height: 52,
                        child: FilledButton(
                          onPressed:
                              _isLoading ? null : _login,
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
                                        FontWeight.bold,
                                  ),
                                ),
                        ),
                      ),

                      const SizedBox(height: 12),

                      const Text(
                        'Đăng nhập bằng Supabase Auth',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 12,
                          color: Colors.grey,
                        ),
                      ),
                    ],
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

  Map<String, dynamic>? profile;

  bool isLoadingProfile = true;
  String? profileError;
  int streak = 0;

  Future<int> _loadStreak() async {
    final user = supabase.auth.currentUser;

    if (user == null) {
    return 0;
    }

    try {
    // ============================================================
    // 1. LẤY TOÀN BỘ LỊCH HỌC CỦA USER
    // ============================================================

    final classData = await supabase
        .from('class_sessions')
        .select('id, day_of_week')
        .eq('user_id', user.id);

    final classes = (classData as List)
        .map((row) => Map<String, dynamic>.from(row))
        .toList();

    // Nếu user chưa có lịch học
    if (classes.isEmpty) {
      return 0;
    }

    // ============================================================
    // 2. LẤY TOÀN BỘ CHECK-IN ĐÃ VERIFIED
    // ============================================================

    final checkInData = await supabase
        .from('check_ins')
        .select(
          'class_session_id, checked_in_at, verification_status',
        )
        .eq('user_id', user.id)
        .eq('verification_status', 'verified')
        .order('checked_in_at', ascending: false);

    final checkIns = (checkInData as List)
        .map((row) => Map<String, dynamic>.from(row))
        .toList();

    // ============================================================
    // 3. TẠO MAP:
    //
    // Date -> tổng số lớp học trong ngày
    //
    // Ví dụ:
    // 2026-09-15 -> 2 lớp
    // 2026-09-16 -> 3 lớp
    // ============================================================

    final Map<DateTime, int> totalClassesByDate = {};

    final now = DateTime.now();

    // Chỉ xét các ngày đã xảy ra cho đến hôm nay.
    //
    // Vì class_sessions chỉ có day_of_week (1-7),
    // ta cần suy ra ngày gần nhất tương ứng với từng thứ.
    //
    // Để tránh việc một lịch học của "thứ Hai" bị tính
    // cho tất cả các thứ Hai trong lịch sử, ta sẽ xét
    // streak theo các ngày gần đây dựa trên lịch tuần hiện tại.
    //
    // Lấy ngày hôm nay làm mốc và xét 365 ngày gần nhất.
    for (int offset = 0; offset <= 365; offset++) {
      final date = DateTime(
        now.year,
        now.month,
        now.day,
      ).subtract(
        Duration(days: offset),
      );

      final weekday = date.weekday;

      final totalClasses = classes.where((classItem) {
        final dayOfWeek =
            (classItem['day_of_week'] as num?)?.toInt();

        return dayOfWeek == weekday;
      }).length;

      if (totalClasses > 0) {
        totalClassesByDate[date] = totalClasses;
      }
    }

    // ============================================================
    // 4. ĐẾM SỐ LỚP ĐÃ CHECK-IN THEO NGÀY
    //
    // Date -> số lớp đã check-in
    // ============================================================

    final Map<DateTime, Set<String>> checkedClassesByDate = {};

    for (final checkIn in checkIns) {
      final rawDate = checkIn['checked_in_at'];

      final classSessionId =
          checkIn['class_session_id']?.toString();

      if (rawDate == null || classSessionId == null) {
        continue;
      }

      final date =
          DateTime.parse(rawDate.toString()).toLocal();

      final dateOnly = DateTime(
    date.year,
        date.month,
        date.day,
      );

      checkedClassesByDate
          .putIfAbsent(dateOnly, () => <String>{})
          .add(classSessionId);
    }

    // ============================================================
    // 5. XÁC ĐỊNH NHỮNG NGÀY ĐẠT >= 75%
    //
    // Ví dụ:
    //
    // 4 lớp, check-in 3
    // 3 / 4 = 75% -> ĐẠT
    //
    // 4 lớp, check-in 2
    // 2 / 4 = 50% -> KHÔNG ĐẠT
    //
    // 1 lớp, check-in 1
    // 1 / 1 = 100% -> ĐẠT
    // ============================================================

    final Set<DateTime> completedDates = {};

    for (final entry in totalClassesByDate.entries) {
      final date = entry.key;
      final totalClasses = entry.value;

      final checkedClasses =
          checkedClassesByDate[date] ?? <String>{};

      final checkedCount = checkedClasses.length;

      final completionRate =
          checkedCount / totalClasses;

      debugPrint(
        'STREAK DATE: $date | '
        'CHECKED: $checkedCount/$totalClasses | '
        'RATE: ${(completionRate * 100).toStringAsFixed(1)}%',
      );

      if (completionRate >= 0.75) {
        completedDates.add(date);
      }
    }

    // ============================================================
    // 6. TÍNH STREAK LIÊN TIẾP
    // ============================================================

    if (completedDates.isEmpty) {
      return 0;
    }

    final today = DateTime(
      now.year,
      now.month,
      now.day,
    );

    final yesterday = today.subtract(
      const Duration(days: 1),
    );

    // ============================================================
    // QUAN TRỌNG:
    //
    // Nếu hôm nay chưa đạt 75%, KHÔNG ĐƯỢC TÍNH HÔM NAY.
    //
    // Nhưng nếu hôm qua đạt thì streak vẫn còn.
    //
    // Ví dụ:
    //
    // Hôm qua: 100%  -> streak
    // Hôm nay: 0%    -> streak vẫn = 1
    //
    // Nhưng:
    //
    // Hôm qua: 50%   -> streak = 0
    // ============================================================

    DateTime? streakStartDate;

    if (completedDates.contains(today)) {
      streakStartDate = today;
    } else if (completedDates.contains(yesterday)) {
      streakStartDate = yesterday;
    } else {
      return 0;
    }

    // ============================================================
    // 7. ĐẾM NGƯỢC CÁC NGÀY ĐẠT 75% LIÊN TIẾP
    // ============================================================

    int streak = 1;

    DateTime currentDate = streakStartDate;

    while (true) {
      final previousDate = currentDate.subtract(
        const Duration(days: 1),
      );

      // Nếu ngày trước đó không có lớp học,
      // thì đó không phải là ngày cần check-in.
      //
      // Ta bỏ qua ngày không có lớp và tiếp tục tìm
      // ngày học trước đó.
      if (!totalClassesByDate.containsKey(previousDate)) {
        currentDate = previousDate;

        // Tìm ngày học gần nhất trước đó.
        DateTime searchDate = previousDate;

        bool foundPreviousClassDay = false;

        for (int i = 0; i < 7; i++) {
          if (totalClassesByDate.containsKey(searchDate)) {
            foundPreviousClassDay = true;
            break;
          }

          searchDate = searchDate.subtract(
    const Duration(days: 1),
          );
        }

        if (!foundPreviousClassDay) {
          break;
        }

        if (completedDates.contains(searchDate)) {
          streak++;
          currentDate = searchDate;
          continue;
        }

        break;
      }

      // Nếu ngày trước đó có lớp nhưng không đạt 75%,
      // streak bị ngắt.
      if (!completedDates.contains(previousDate)) {
        break;
      }

      streak++;

      currentDate = previousDate;
    }

    debugPrint(
      'FINAL STREAK: $streak',
    );

    return streak;

    } catch (e) {
    debugPrint(
    'Load streak error: $e',
    );

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
        throw Exception(
          'Chưa có người dùng đăng nhập.',
        );
      }

      final data = await supabase
          .from('users')
          .select(
            'student_code, name, email, class_name',
          )
          .eq('id', user.id)
          .single();

      if (!mounted) return;

      setState(() {
        profile = data;
        isLoadingProfile = false;
        profileError = null;
      });

      debugPrint(
        'Loaded profile: $data',
      );
    } catch (e) {
      if (!mounted) return;

      setState(() {
        profileError = e.toString();
        isLoadingProfile = false;
      });

      debugPrint(
        'Load profile error: $e',
      );
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

      // Dart:
      // 1 = Thứ Hai
      // 2 = Thứ Ba
      // 3 = Thứ Tư
      // ...
      // 7 = Chủ Nhật
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
            subjects (
              name,
              subject_code,
              teacher
            )
          ''')
          .eq('user_id', user.id)
          .eq('day_of_week', today)
          .order('start_time');

      final classes = (data as List)
          .map(
            (item) => ClassSession.fromMap(
              Map<String, dynamic>.from(item),
            ),
          )
          .toList();

      if (!mounted) return;

      setState(() {
        todayClasses = classes;
        isLoadingClasses = false;
        classError = null;
      });

      debugPrint(
        'Loaded ${classes.length} classes for weekday $today',
      );
    } catch (e) {
      if (!mounted) return;

      setState(() {
        isLoadingClasses = false;
        classError = e.toString();
      });

      debugPrint(
        'Load classes error: $e',
      );
    }
  }

  // ==========================================================
  // BUILD CLASS LIST
  // ==========================================================

  Widget _buildTodayClasses() {
    if (isLoadingClasses) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: CircularProgressIndicator(),
        ),
      );
    }

    if (classError != null) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.red.withOpacity(0.08),
          borderRadius:
              BorderRadius.circular(16),
        ),
        child: Column(
          crossAxisAlignment:
              CrossAxisAlignment.start,
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
            const SizedBox(height: 12),
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
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius:
              BorderRadius.circular(16),
        ),
        child: const Text(
          'Hôm nay không có lịch học.',
          textAlign: TextAlign.center,
        ),
      );
    }

    return Column(
      children: todayClasses.map(
        (classSession) {
          return Card(
            margin:
                const EdgeInsets.only(bottom: 12),
            child: ListTile(
              contentPadding:
                  const EdgeInsets.all(12),

              leading: Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color:
                      const Color(0xFFEAF4FF),
                  borderRadius:
                      BorderRadius.circular(14),
                ),
                child: const Icon(
                  Icons.school,
                  color:
                      Color(0xFF005BAC),
                ),
              ),

              title: Text(
                classSession.subject,
                style: const TextStyle(
                  fontWeight: FontWeight.bold,
                ),
              ),

              subtitle: Padding(
                padding:
                    const EdgeInsets.only(top: 6),
                child: Text(
                  '${classSession.time} • '
                  '${classSession.room}\n'
                  '${classSession.teacher}',
                ),
              ),

              isThreeLine: true,

              trailing: const Icon(
                Icons.chevron_right,
              ),

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
            ),
          );
        },
      ).toList(),
    );
  }

  // ==========================================================
  // BUILD
  // ==========================================================

  @override
  Widget build(BuildContext context) {
    if (isLoadingProfile) {
      return const Scaffold(
        body: Center(
          child:
              CircularProgressIndicator(),
        ),
      );
    }

    if (profileError != null) {
      return Scaffold(
        appBar: AppBar(
          title:
              const Text('DUT Campus Streak'),
        ),
        body: Center(
          child: Padding(
            padding:
                const EdgeInsets.all(24),
            child: Column(
              mainAxisSize:
                  MainAxisSize.min,
              children: [
                const Text(
                  'Không thể tải thông tin sinh viên.',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight:
                        FontWeight.bold,
                  ),
                  textAlign:
                      TextAlign.center,
                ),

                const SizedBox(height: 12),

                Text(
                  profileError!,
                  textAlign:
                      TextAlign.center,
                ),

                const SizedBox(height: 20),

                ElevatedButton(
                  onPressed: _loadProfile,
                  child:
                      const Text('Thử lại'),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final name =
        profile?['name'] ?? 'Sinh viên';

    final studentCode =
        profile?['student_code'] ?? '';

    final className =
        profile?['class_name'] ?? '';

    return Scaffold(
      backgroundColor:
          const Color(0xFFEAF4FF),

      appBar: AppBar(
        title:
            const Text('DUT Campus Streak'),
        backgroundColor:
            Colors.transparent,
      ),

      body: RefreshIndicator(
        onRefresh: () async {
          await Future.wait([
            _loadProfile(),
            _loadTodayClasses(),
            _loadStreakData(),
          ]);
        },

        child: SingleChildScrollView(
          physics:
              const AlwaysScrollableScrollPhysics(),

          padding:
              const EdgeInsets.all(16),

          child: Column(
            crossAxisAlignment:
                CrossAxisAlignment.start,

            children: [
              Text(
                'Xin chào, $name 👋',
                style:
                    const TextStyle(
                  fontSize: 24,
                  fontWeight:
                      FontWeight.bold,
                ),
              ),

              const SizedBox(height: 8),

              Text(
                '$studentCode • $className',
                style: TextStyle(
                  fontSize: 14,
                  color:
                      Colors.grey[600],
                ),
              ),

              const SizedBox(height: 24),

              // ==================================================
              // STREAK - TẠM THỜI
              // ==================================================

              Container(
                width: double.infinity,
                padding:
                    const EdgeInsets.all(20),

                decoration:
                    BoxDecoration(
                  borderRadius:
                      BorderRadius.circular(16),
                  color:
                      const Color(0xFF005BAC),
                ),

                child: Column(
                  crossAxisAlignment:
                      CrossAxisAlignment.start,
                  children: [
                    Text(
                      '🔥 Streak',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 18,
                      ),
                    ),

                    SizedBox(height: 8),

                    Text(
                      '$streak ngày',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 32,
                        fontWeight:
                            FontWeight.bold,
                      ),
                    ),

                    const SizedBox(height: 4),

                    Text(
                      streak == 0 ? 'Hãy hoàn thành Check-in để bắt đầu streak': 'Tiếp tục Check-in để duy trì streak',
                      style: TextStyle(
                        color: Colors.white70,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 24),

              const Text(
                'Lớp học hôm nay',
                style: TextStyle(
                  fontSize: 20,
                  fontWeight:
                      FontWeight.bold,
                ),
              ),

              const SizedBox(height: 12),

              _buildTodayClasses(),

              const SizedBox(height: 24),

              // ==================================================
              // MENU
              // ==================================================

              Card(
                child: ListTile(
                  leading: const Icon(
                    Icons.calendar_month,
                    color:
                        Color(0xFF005BAC),
                  ),
                  title:
                      const Text('Lịch học'),
                  subtitle: const Text(
                    'Xem toàn bộ lịch học',
                  ),
                  trailing:
                      const Icon(
                    Icons.chevron_right,
                  ),
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
              ),

              Card(
                child: ListTile(
                  leading: const Icon(
                    Icons.leaderboard,
                  ),
                  title:
                      const Text('Xếp hạng'),
                  trailing:
                      const Icon(
                    Icons.chevron_right,
                  ),
                ),
              ),

              Card(
                child: ListTile(
                  leading: const Icon(
                    Icons.emoji_events,
                  ),
                  title:
                      const Text('Thành tích'),
                  trailing:
                      const Icon(
                    Icons.chevron_right,
                  ),
                ),
              ),

              Card(
                child: ListTile(
                  leading: const Icon(
                    Icons.person,
                  ),
                  title:
                      const Text('Hồ sơ'),
                  trailing:
                      const Icon(
                    Icons.chevron_right,
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
            subjects (
              name,
              subject_code,
              teacher
            )
          ''')
          .eq('user_id', user.id)
          .order('day_of_week')
          .order('start_time');

      final loadedClasses = (data as List)
          .map(
            (item) => ClassSession.fromMap(
              Map<String, dynamic>.from(item),
            ),
          )
          .toList();

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
  // BUILD DAY SECTION
  // ==========================================================

  Widget _buildDaySection(int day) {
    final dayClasses = classes
        .where(
          (item) =>
              item.dayOfWeek == day,
        )
        .toList();

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
              classSession:
                  classSession,
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
                  for (
                    int day = 1;
                    day <= 7;
                    day++
                  )
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

  const ScheduleCard({
    super.key,
    required this.classSession,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
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
            width: 60,
            padding:
                const EdgeInsets.symmetric(
              vertical: 10,
            ),

            decoration:
                BoxDecoration(
              color:
                  const Color(0xFFEAF4FF),
              borderRadius:
                  BorderRadius.circular(14),
            ),

            child: Column(
              children: [
                const Icon(
                  Icons.access_time,
                  color:
                      Color(0xFF005BAC),
                ),

                const SizedBox(height: 4),

                Text(
                  classSession.startTime,
                  style:
                      const TextStyle(
                    fontWeight:
                        FontWeight.bold,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(width: 16),

          Expanded(
            child: Column(
              crossAxisAlignment:
                  CrossAxisAlignment.start,

              children: [
                Text(
                  classSession.subject,
                  style:
                      const TextStyle(
                    fontSize: 17,
                    fontWeight:
                        FontWeight.bold,
                  ),
                ),

                const SizedBox(height: 6),

                Text(
                  '${classSession.startTime} – '
                  '${classSession.endTime}',
                  style:
                      const TextStyle(
                    color:
                        Colors.black54,
                  ),
                ),

                const SizedBox(height: 4),

                Text(
                  'Phòng ${classSession.room}',
                  style:
                      const TextStyle(
                    color:
                        Colors.black54,
                  ),
                ),

                const SizedBox(height: 4),

                Text(
                  classSession.teacher,
                  style:
                      const TextStyle(
                    color:
                        Colors.black45,
                    fontSize: 13,
                  ),
                ),
              ],
            ),
          ),
        ],
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