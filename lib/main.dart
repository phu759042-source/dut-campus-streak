import 'dart:io';

import 'package:flutter/material.dart';
import 'package:camera/camera.dart';
import 'package:image_picker/image_picker.dart';
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
      home: const AuthGate(),
    );
  }
}

// ============================================================
// MODEL
// ============================================================

class ClassSession {
  final String id;
  final String subjectId;
  final String subjectCode;
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
    required this.subjectId,
    required this.subjectCode,
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
      subjectId: subjectMap?['id']?.toString() ?? map['subject_id']?.toString() ?? '',
      subjectCode: subjectMap?['subject_code']?.toString() ?? '',
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
                              'Nhập email của bạn',
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

                      OutlinedButton(
                        onPressed: _isLoading
                            ? null
                            : () {
                                Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                    builder: (_) => const SignUpScreen(),
                                  ),
                                );
                              },
                        child: const Text('Tạo tài khoản mới'),
                      ),

                      const SizedBox(height: 12),

                      const Text(
                        'Mật khẩu được Supabase Auth quản lý.',
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
// SIGN UP
// ============================================================

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
                      : () => Navigator.of(dialogContext).pop(false),
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

    newPasswordController.dispose();
    confirmPasswordController.dispose();

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
        .select('id, day_of_week, subjects!inner(subject_code)')
        .eq('user_id', user.id);

    final classes = (classData as List)
        .map((row) => Map<String, dynamic>.from(row))
        .where((row) {
          final subject = row['subjects'];
          final code = subject is Map ? subject['subject_code']?.toString() : null;
          return code != '0130011.2610.26.17';
        })
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
            subject_id,
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

    final displayName =
        profile?['display_name'] ?? profile?['name'] ?? 'Sinh viên';

    final avatarUrl = profile?['avatar_url']?.toString();

    final studentCode =
        profile?['student_code'] ?? '';

    final className =
        profile?['class_name'] ?? '';

    return Scaffold(
      backgroundColor:
          const Color(0xFFEAF4FF),

      appBar: AppBar(
        title: const Text('DUT Campus Streak'),
        backgroundColor: Colors.transparent,
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: InkWell(
              borderRadius: BorderRadius.circular(24),
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
              child: CircleAvatar(
                radius: 20,
                backgroundImage: avatarUrl != null && avatarUrl!.isNotEmpty
                    ? NetworkImage(avatarUrl!)
                    : null,
                child: avatarUrl == null || avatarUrl!.isEmpty
                    ? const Icon(Icons.person)
                    : null,
              ),
            ),
          ),
        ],
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
                'Xin chào, $displayName 👋',
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
                      const Icon(Icons.chevron_right),
                  onTap: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const LeaderboardScreen(),
                      ),
                    );
                  },
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
                      const Icon(Icons.chevron_right),
                  onTap: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const AchievementsScreen(),
                      ),
                    );
                  },
                ),
              ),

              Card(
                child: ListTile(
                  leading: const Icon(
                    Icons.person,
                  ),
                  title: const Text('Hồ sơ'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () async {
                    await Navigator.push(
                      context,
                      MaterialPageRoute(builder: (_) => const ProfileScreen()),
                    );
                    if (mounted) {
                      await _loadProfile();
                    }
                  },
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
    return const AchievementStats(totalCheckIns: 0, longestStreak: 0);
  }

  final classData = await supabase
      .from('class_sessions')
      .select('id, day_of_week, subjects!inner(subject_code)')
      .eq('user_id', user.id);

  final classes = (classData as List)
        .map((row) => Map<String, dynamic>.from(row))
        .where((row) {
          final subject = row['subjects'];
          final code = subject is Map ? subject['subject_code']?.toString() : null;
          return code != '0130011.2610.26.17';
        })
        .toList();

  final checkInData = await supabase
      .from('check_ins')
      .select('class_session_id, checked_in_at')
      .eq('user_id', user.id)
      .eq('verification_status', 'verified')
      .order('checked_in_at');

  final checkIns = (checkInData as List)
      .map((row) => Map<String, dynamic>.from(row))
      .toList();

  final totalCheckIns = checkIns.length;

  if (classes.isEmpty || checkIns.isEmpty) {
    return AchievementStats(
      totalCheckIns: totalCheckIns,
      longestStreak: 0,
    );
  }

  final Map<DateTime, Set<String>> checkedClassesByDate = {};

  for (final checkIn in checkIns) {
    final rawDate = checkIn['checked_in_at'];
    final classSessionId = checkIn['class_session_id']?.toString();

    if (rawDate == null || classSessionId == null) continue;

    final localDate = DateTime.parse(rawDate.toString()).toLocal();
    final dateOnly = DateTime(
      localDate.year,
      localDate.month,
      localDate.day,
    );

    checkedClassesByDate
        .putIfAbsent(dateOnly, () => <String>{})
        .add(classSessionId);
  }

  final Map<DateTime, int> totalClassesByDate = {};
  final Set<DateTime> completedDates = {};
  final now = DateTime.now();

  for (int offset = 0; offset <= 365; offset++) {
    final date = DateTime(
      now.year,
      now.month,
      now.day,
    ).subtract(Duration(days: offset));

    final totalClasses = classes.where((classItem) {
      final dayOfWeek = (classItem['day_of_week'] as num?)?.toInt();
      return dayOfWeek == date.weekday;
    }).length;

    if (totalClasses == 0) continue;

    totalClassesByDate[date] = totalClasses;

    final checkedCount = checkedClassesByDate[date]?.length ?? 0;

    if (checkedCount / totalClasses >= 0.75) {
      completedDates.add(date);
    }
  }

  int longestStreak = 0;
  int currentStreak = 0;

  for (int offset = 365; offset >= 0; offset--) {
    final date = DateTime(
      now.year,
      now.month,
      now.day,
    ).subtract(Duration(days: offset));

    if (!totalClassesByDate.containsKey(date)) {
      continue;
    }

    if (completedDates.contains(date)) {
      currentStreak++;
      if (currentStreak > longestStreak) {
        longestStreak = currentStreak;
      }
    } else {
      currentStreak = 0;
    }
  }

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
          child: Text(
            '${_totalCheckIns(row)} check-in đã xác minh',
            style: const TextStyle(fontSize: 12),
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
    final isGdtc = RegExp(r'^[A-Z]\d{2}-.+', caseSensitive: false)
        .hasMatch(beforeSchedule.first);

    // Dòng GDTC có mã lớp B26-GDTC1-17 ngay sau mã môn.
    // Đây là tên muốn hiển thị trong app.
    final subjectName = beforeSchedule.first;

    final teacherCandidate = beforeSchedule.last;
    final teacher = isGdtc || teacherCandidate == subjectName
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
  State<ScheduleScreen> createState() => _ScheduleScreenState();
}

class _ScheduleScreenState extends State<ScheduleScreen> {
  List<ClassSession> classes = [];
  bool isLoading = true;
  String? errorMessage;

  @override
  void initState() {
    super.initState();
    _loadClasses();
  }

  Future<void> _loadClasses() async {
    try {
      if (mounted) setState(() { isLoading = true; errorMessage = null; });
      final user = supabase.auth.currentUser;
      if (user == null) throw Exception('Chưa đăng nhập.');
      final data = await supabase.from('class_sessions').select('id, subject_id, room, start_time, end_time, teacher, day_of_week, subjects(id, name, subject_code, teacher)').eq('user_id', user.id).order('day_of_week').order('start_time');
      final loaded = (data as List).map((item) => ClassSession.fromMap(Map<String, dynamic>.from(item))).toList();
      if (!mounted) return;
      setState(() { classes = loaded; isLoading = false; });
    } catch (e) {
      debugPrint('Load schedule error: $e');
      if (!mounted) return;
      setState(() { isLoading = false; errorMessage = e.toString(); });
    }
  }

  String _dayName(int day) => const {
    1: 'Thứ Hai', 2: 'Thứ Ba', 3: 'Thứ Tư', 4: 'Thứ Năm',
    5: 'Thứ Sáu', 6: 'Thứ Bảy', 7: 'Chủ Nhật',
  }[day] ?? 'Không xác định';

  Future<ScheduleImportResult> _importScheduleText(String text) async {
    final user = supabase.auth.currentUser;
    if (user == null) throw Exception('Chưa đăng nhập.');
    final courses = _parsePastedSchedule(text);
    var insertedSessions = 0;
    var skippedSessions = 0;
    final warnings = <String>[];

    for (final course in courses) {
      Map<String, dynamic>? subject;
      final existing = await supabase.from('subjects').select('id, name, teacher, subject_code')
          .eq('user_id', user.id).eq('subject_code', course.subjectCode).limit(1);
      if (existing.isNotEmpty) {
        subject = Map<String, dynamic>.from(existing.first);
        await supabase.from('subjects').update({
          'name': course.subjectName,
          'teacher': course.teacher.isEmpty ? null : course.teacher,
        }).eq('id', subject['id']);
      } else {
        final inserted = await supabase.from('subjects').insert({
          'user_id': user.id, 'subject_code': course.subjectCode,
          'name': course.subjectName, 'teacher': course.teacher.isEmpty ? null : course.teacher,
        }).select('id, name, teacher, subject_code').single();
        subject = Map<String, dynamic>.from(inserted);
      }
      final subjectId = subject['id']?.toString();
      if (subjectId == null || subjectId.isEmpty) throw Exception('Không lấy được ID môn ${course.subjectName}.');
      for (final meeting in course.meetings) {
        final startTime = _periodStartTime(meeting.startPeriod);
        final endTime = _periodEndTime(meeting.endPeriod);
        final existingSessions = await supabase.from('class_sessions').select('id')
            .eq('user_id', user.id).eq('subject_id', subjectId)
            .eq('day_of_week', meeting.dayOfWeek).eq('room', meeting.room)
            .eq('start_time', startTime).eq('end_time', endTime).limit(1);
        if (existingSessions.isNotEmpty) { skippedSessions++; continue; }
        await supabase.from('class_sessions').insert({
          'user_id': user.id, 'subject_id': subjectId, 'room': meeting.room,
          'start_time': startTime, 'end_time': endTime,
          'teacher': course.teacher.isEmpty ? null : course.teacher,
          'day_of_week': meeting.dayOfWeek,
        });
        insertedSessions++;
      }
    }
    if (skippedSessions > 0) warnings.add('$skippedSessions buổi đã có sẵn nên được bỏ qua, không tạo trùng.');
    return ScheduleImportResult(courseCount: courses.length, sessionCount: insertedSessions, skippedLineCount: 0, warnings: warnings);
  }

  Future<void> _showAddMenu() async {
    await showModalBottomSheet<void>(
      context: context, showDragHandle: true,
      builder: (sheetContext) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(
          leading: const Icon(Icons.content_paste_rounded),
          title: const Text('Dán từ trang sinh viên'),
          subtitle: const Text('Copy nguyên bảng rồi dán vào app'),
          onTap: () { Navigator.pop(sheetContext); _showImportScheduleDialog(); },
        ),
        ListTile(
          leading: const Icon(Icons.edit_calendar_rounded),
          title: const Text('Thêm lịch thủ công'),
          subtitle: const Text('Tự nhập môn, thứ, tiết, phòng, giảng viên'),
          onTap: () { Navigator.pop(sheetContext); _showManualScheduleDialog(); },
        ),
        const SizedBox(height: 8),
      ])),
    );
  }

  Future<void> _showImportScheduleDialog() async {
    final controller = TextEditingController();
    bool importing = false;
    String? dialogError;
    final result = await showDialog<ScheduleImportResult>(
      context: context, barrierDismissible: !importing,
      builder: (dialogContext) => StatefulBuilder(builder: (context, setDialogState) {
        Future<void> submit() async {
          final text = controller.text.trim();
          if (text.isEmpty) { setDialogState(() => dialogError = 'Hãy dán bảng lịch học vào ô bên trên.'); return; }
          setDialogState(() { importing = true; dialogError = null; });
          try {
            final result = await _importScheduleText(text);
            if (!mounted) return;
            Navigator.of(dialogContext).pop(result);
          } catch (e) {
            setDialogState(() { importing = false; dialogError = e is FormatException ? e.message : 'Không thể thêm lịch học: $e'; });
          }
        }
        return AlertDialog(
          title: const Text('Dán lịch từ trang sinh viên'),
          content: SizedBox(width: 600, child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const Text('Copy nguyên bảng lịch học từ trang sinh viên rồi dán vào đây.'),
            const SizedBox(height: 14),
            TextField(controller: controller, enabled: !importing, minLines: 10, maxLines: 18, keyboardType: TextInputType.multiline,
              decoration: InputDecoration(hintText: 'Dán bảng lịch học vào đây...', alignLabelWithHint: true, border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)))),
            if (dialogError != null) ...[const SizedBox(height: 12), Text(dialogError!, style: const TextStyle(color: Colors.red, fontSize: 13))],
            const SizedBox(height: 10),
            const Text('Lưu ý: tuần học hiện chưa được lưu vào class_sessions.', style: TextStyle(color: Colors.black45, fontSize: 12)),
          ]))),
          actions: [
            TextButton(onPressed: importing ? null : () => Navigator.pop(dialogContext), child: const Text('Hủy')),
            FilledButton.icon(onPressed: importing ? null : submit,
              icon: importing ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.download_rounded),
              label: Text(importing ? 'Đang thêm...' : 'Thêm lịch')),
          ],
        );
      }),
    );
    controller.dispose();
    if (result == null || !mounted) return;
    await _loadClasses();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Đã xử lý ${result.courseCount} môn, thêm ${result.sessionCount} buổi học.${result.warnings.isEmpty ? '' : ' ${result.warnings.join(' ')}'}')));
  }

  Future<void> _showManualScheduleDialog({ClassSession? editing}) async {
    final user = supabase.auth.currentUser;
    if (user == null) return;
    final codeController = TextEditingController(text: editing?.subjectCode ?? '');
    final nameController = TextEditingController(text: editing?.subject ?? '');
    final teacherController = TextEditingController(text: editing?.teacher ?? '');
    final roomController = TextEditingController(text: editing?.room ?? '');
    int day = editing?.dayOfWeek ?? 1;
    int startPeriod = editing == null ? 1 : _timeToStartPeriod(editing.startTime) ?? 1;
    int endPeriod = editing == null ? 1 : _timeToEndPeriod(editing.endTime) ?? startPeriod;
    bool saving = false;
    String? error;

    final result = await showDialog<bool>(
      context: context, barrierDismissible: !saving,
      builder: (dialogContext) => StatefulBuilder(builder: (context, setDialogState) {
        Future<void> save() async {
          final code = codeController.text.trim();
          final name = nameController.text.trim();
          final teacher = teacherController.text.trim();
          final room = roomController.text.trim();
          if (code.isEmpty || name.isEmpty || room.isEmpty) { setDialogState(() => error = 'Mã môn, tên môn và phòng không được để trống.'); return; }
          if (startPeriod > endPeriod) { setDialogState(() => error = 'Tiết bắt đầu phải nhỏ hơn hoặc bằng tiết kết thúc.'); return; }
          setDialogState(() { saving = true; error = null; });
          try {
            final startTime = _periodStartTime(startPeriod);
            final endTime = _periodEndTime(endPeriod);
            if (editing != null) {
              if (code != editing.subjectCode) {
                final duplicate = await supabase.from('subjects').select('id').eq('user_id', user.id).eq('subject_code', code).neq('id', editing.subjectId).limit(1);
                if (duplicate.isNotEmpty) throw Exception('Mã môn này đã tồn tại trong lịch học của bạn.');
              }
              await supabase.from('subjects').update({'subject_code': code, 'name': name, 'teacher': teacher.isEmpty ? null : teacher}).eq('id', editing.subjectId).eq('user_id', user.id);
              await supabase.from('class_sessions').update({'room': room, 'start_time': startTime, 'end_time': endTime, 'teacher': teacher.isEmpty ? null : teacher, 'day_of_week': day}).eq('id', editing.id).eq('user_id', user.id);
            } else {
              final existing = await supabase.from('subjects').select('id').eq('user_id', user.id).eq('subject_code', code).limit(1);
              String subjectId;
              if (existing.isNotEmpty) {
                subjectId = existing.first['id'].toString();
                await supabase.from('subjects').update({'name': name, 'teacher': teacher.isEmpty ? null : teacher}).eq('id', subjectId).eq('user_id', user.id);
              } else {
                final inserted = await supabase.from('subjects').insert({'user_id': user.id, 'subject_code': code, 'name': name, 'teacher': teacher.isEmpty ? null : teacher}).select('id').single();
                subjectId = inserted['id'].toString();
              }
              await supabase.from('class_sessions').insert({'user_id': user.id, 'subject_id': subjectId, 'room': room, 'start_time': startTime, 'end_time': endTime, 'teacher': teacher.isEmpty ? null : teacher, 'day_of_week': day});
            }
            if (!mounted) return;
            Navigator.pop(dialogContext, true);
          } catch (e) {
            setDialogState(() { saving = false; error = 'Không thể lưu lịch học: $e'; });
          }
        }
        return AlertDialog(
          title: Text(editing == null ? 'Thêm lịch thủ công' : 'Chỉnh sửa lịch học'),
          content: SizedBox(width: 520, child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(controller: codeController, enabled: !saving, decoration: const InputDecoration(labelText: 'Mã môn', prefixIcon: Icon(Icons.code), border: OutlineInputBorder())),
            const SizedBox(height: 12),
            TextField(controller: nameController, enabled: !saving, decoration: const InputDecoration(labelText: 'Tên môn', prefixIcon: Icon(Icons.menu_book_outlined), border: OutlineInputBorder())),
            const SizedBox(height: 12),
            TextField(controller: teacherController, enabled: !saving, decoration: const InputDecoration(labelText: 'Giảng viên', prefixIcon: Icon(Icons.person_outline), border: OutlineInputBorder())),
            const SizedBox(height: 12),
            TextField(controller: roomController, enabled: !saving, decoration: const InputDecoration(labelText: 'Phòng', prefixIcon: Icon(Icons.room_outlined), border: OutlineInputBorder())),
            const SizedBox(height: 12),
            DropdownButtonFormField<int>(value: day, decoration: const InputDecoration(labelText: 'Thứ', border: OutlineInputBorder()), items: List.generate(7, (i) => DropdownMenuItem(value: i + 1, child: Text(_dayName(i + 1)))), onChanged: saving ? null : (v) => setDialogState(() => day = v ?? 1)),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: DropdownButtonFormField<int>(value: startPeriod, decoration: const InputDecoration(labelText: 'Tiết bắt đầu', border: OutlineInputBorder()), items: List.generate(14, (i) => DropdownMenuItem(value: i + 1, child: Text('Tiết ${i + 1}'))), onChanged: saving ? null : (v) => setDialogState(() { startPeriod = v ?? 1; if (endPeriod < startPeriod) endPeriod = startPeriod; }))),
              const SizedBox(width: 12),
              Expanded(child: DropdownButtonFormField<int>(value: endPeriod, decoration: const InputDecoration(labelText: 'Tiết kết thúc', border: OutlineInputBorder()), items: List.generate(14, (i) => DropdownMenuItem(value: i + 1, child: Text('Tiết ${i + 1}'))), onChanged: saving ? null : (v) => setDialogState(() => endPeriod = v ?? startPeriod))),
            ]),
            if (error != null) ...[const SizedBox(height: 12), Align(alignment: Alignment.centerLeft, child: Text(error!, style: const TextStyle(color: Colors.red, fontSize: 13)))],
          ]))),
          actions: [
            TextButton(onPressed: saving ? null : () => Navigator.pop(dialogContext), child: const Text('Hủy')),
            FilledButton.icon(onPressed: saving ? null : save, icon: saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.save_outlined), label: Text(saving ? 'Đang lưu...' : 'Lưu')),
          ],
        );
      }),
    );
    codeController.dispose(); nameController.dispose(); teacherController.dispose(); roomController.dispose();
    if (result == true && mounted) { await _loadClasses(); if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(editing == null ? 'Đã thêm lịch học.' : 'Đã cập nhật lịch học.'))); }
  }

  int? _timeToStartPeriod(String value) => const {
    '07:00:00': 1, '08:00:00': 2, '09:00:00': 3, '10:00:00': 4, '11:00:00': 5,
    '12:30:00': 6, '13:30:00': 7, '14:30:00': 8, '15:30:00': 9, '16:30:00': 10,
    '17:30:00': 11, '18:15:00': 12, '19:10:00': 13, '19:55:00': 14,
  }[value.trim()];

  int? _timeToEndPeriod(String value) => const {
    '07:50:00': 1, '08:50:00': 2, '09:50:00': 3, '10:50:00': 4, '11:50:00': 5,
    '13:20:00': 6, '14:20:00': 7, '15:20:00': 8, '16:20:00': 9, '17:20:00': 10,
    '18:15:00': 11, '19:00:00': 12, '19:50:00': 13, '20:40:00': 14,
  }[value.trim()];

  Future<void> _showSessionActions(ClassSession session) async {
    final action = await showModalBottomSheet<String>(
      context: context, showDragHandle: true,
      builder: (sheetContext) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(leading: const Icon(Icons.edit_outlined), title: const Text('Chỉnh sửa'), subtitle: const Text('Đổi tên môn, giảng viên, phòng, thứ hoặc tiết'), onTap: () => Navigator.pop(sheetContext, 'edit')),
        ListTile(leading: const Icon(Icons.delete_outline, color: Colors.red), title: const Text('Xóa buổi học', style: TextStyle(color: Colors.red)), onTap: () => Navigator.pop(sheetContext, 'delete')),
        const SizedBox(height: 8),
      ])),
    );
    if (action == 'edit' && mounted) await _showManualScheduleDialog(editing: session);
    if (action == 'delete' && mounted) await _deleteSession(session);
  }

  Future<void> _deleteSession(ClassSession session) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Xóa buổi học?'),
        content: Text('Xóa "${session.subject}" vào ${_dayName(session.dayOfWeek)}, ${session.time}, phòng ${session.room}?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Hủy')),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: Colors.red), onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Xóa')),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      final user = supabase.auth.currentUser;
      if (user == null) throw Exception('Chưa đăng nhập.');
      await supabase.from('class_sessions').delete().eq('id', session.id).eq('user_id', user.id);
      final remaining = await supabase.from('class_sessions').select('id').eq('subject_id', session.subjectId).limit(1);
      if (remaining.isEmpty && session.subjectId.isNotEmpty) await supabase.from('subjects').delete().eq('id', session.subjectId).eq('user_id', user.id);
      await _loadClasses();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Đã xóa buổi học.')));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Không thể xóa buổi học: $e')));
    }
  }

  Widget _buildDaySection(int day) {
    final dayClasses = classes.where((item) => item.dayOfWeek == day).toList();
    if (dayClasses.isEmpty) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(_dayName(day), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
      const SizedBox(height: 16),
      ...dayClasses.map((session) => Padding(padding: const EdgeInsets.only(bottom: 14), child: ScheduleCard(classSession: session, onTap: () => _showSessionActions(session)))),
      const SizedBox(height: 12),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    if (isLoading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    if (errorMessage != null) return Scaffold(appBar: AppBar(title: const Text('Lịch học')), body: Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
      const Icon(Icons.error_outline, color: Colors.red, size: 48), const SizedBox(height: 16),
      const Text('Không thể tải lịch học.', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)), const SizedBox(height: 10),
      Text(errorMessage!, textAlign: TextAlign.center), const SizedBox(height: 20), ElevatedButton(onPressed: _loadClasses, child: const Text('Thử lại')),
    ]))));
    return Scaffold(
      backgroundColor: const Color(0xFFEAF4FF),
      appBar: AppBar(title: const Text('Lịch học', style: TextStyle(fontWeight: FontWeight.bold)), backgroundColor: Colors.transparent, actions: [IconButton(tooltip: 'Thêm lịch học', onPressed: _showAddMenu, icon: const Icon(Icons.add_circle_outline))]),
      body: classes.isEmpty
          ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [const Text('Chưa có lịch học.'), const SizedBox(height: 12), FilledButton.icon(onPressed: _showAddMenu, icon: const Icon(Icons.add), label: const Text('Thêm lịch học'))]))
          : RefreshIndicator(onRefresh: _loadClasses, child: ListView(padding: const EdgeInsets.all(20), children: [
              for (int day = 1; day <= 7; day++) _buildDaySection(day),
              Container(padding: const EdgeInsets.all(18), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20)), child: const Row(children: [Icon(Icons.info_outline, color: Color(0xFF005BAC)), SizedBox(width: 12), Expanded(child: Text('Chạm vào một buổi học để chỉnh sửa hoặc xóa.'))])),
            ])),
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