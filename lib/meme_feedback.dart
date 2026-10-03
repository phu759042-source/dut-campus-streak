import 'dart:math';
import 'package:flutter/services.dart';
import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';

/// Meme + MP3 feedback for the four DUT Campus Streak events.
enum MemeFeedbackType {
  checkinSuccess,
  checkinFailure,
  deadlineSuccess,
  deadlineFailure,
}

class MemeFeedback {
  MemeFeedback._();

  static final AudioPlayer _player = AudioPlayer();
  static final Random _random = Random();

  

static const Map<MemeFeedbackType, String> _memeFolders = {
  MemeFeedbackType.checkinSuccess: 'assets/memes/checkin_success/',
  MemeFeedbackType.checkinFailure: 'assets/memes/checkin_failure/',
  MemeFeedbackType.deadlineSuccess: 'assets/memes/deadline_success/',
  MemeFeedbackType.deadlineFailure: 'assets/memes/deadline_failure/',
};

static Future<List<String>> _getImages(
  MemeFeedbackType type,
) async {
  final manifest =
      await AssetManifest.loadFromAssetBundle(rootBundle);

  final folder = _memeFolders[type]!;

  return manifest
      .listAssets()
      .where(
        (path) =>
            path.startsWith(folder) &&
            RegExp(
              r'\.(jpg|jpeg|png|webp)$',
              caseSensitive: false,
            ).hasMatch(path),
      )
      .toList();
}

  static const Map<MemeFeedbackType, String> _sounds = {
    MemeFeedbackType.checkinSuccess: 'sounds/checkin_success.mp3',
    MemeFeedbackType.checkinFailure: 'sounds/checkin_failure.mp3',
    MemeFeedbackType.deadlineSuccess: 'sounds/deadline_success.mp3',
    MemeFeedbackType.deadlineFailure: 'sounds/deadline_failure.mp3',
  };

  static const Map<MemeFeedbackType, String> _titles = {
    MemeFeedbackType.checkinSuccess: 'CHECK-IN THÀNH CÔNG!',
    MemeFeedbackType.checkinFailure: 'CHECK-IN THẤT BẠI!',
    MemeFeedbackType.deadlineSuccess: 'HOÀN THÀNH DEADLINE!',
    MemeFeedbackType.deadlineFailure: 'DEADLINE QUÁ HẠN!',
  };

  /// Displays a randomly selected meme from the matching group and always
  /// plays the same MP3 for that event type.
  static Future<void> show(
    BuildContext context,
    MemeFeedbackType type, {
    Duration autoCloseAfter = const Duration(seconds: 3),
  }) async {
    final images = await _getImages(type);

    if (images.isEmpty) {
      debugPrint('Không tìm thấy meme trong thư mục: ${_memeFolders[type]}');
      return;
    }

    final image = images[_random.nextInt(images.length)];

    // Do not let audio playback errors prevent the feedback dialog.
    try {
      await _player.stop();
      await _player.play(AssetSource(_sounds[type]!));
    } catch (e) {
      debugPrint('Meme feedback audio error: $e');
    }

    if (!context.mounted) return;

    showGeneralDialog<void>(
      context: context,
      barrierDismissible: true,
      barrierLabel: 'Đóng thông báo',
      barrierColor: Colors.black54,
      transitionDuration: const Duration(milliseconds: 250),
      pageBuilder: (dialogContext, animation, secondaryAnimation) {
        Future<void>.delayed(autoCloseAfter, () {
          if (dialogContext.mounted && Navigator.of(dialogContext).canPop()) {
            Navigator.of(dialogContext).pop();
          }
        });
        return Center(
          child: Material(
            color: Colors.transparent,
            child: Container(
              margin: const EdgeInsets.symmetric(horizontal: 24),
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color: Theme.of(dialogContext).colorScheme.surface,
                borderRadius: BorderRadius.circular(24),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    _titles[type]!,
                    textAlign: TextAlign.center,
                    style: Theme.of(dialogContext).textTheme.titleLarge
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 14),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(16),
                    child: Image.asset(
                      image,
                      height: 260,
                      width: double.infinity,
                      fit: BoxFit.contain,
                      errorBuilder: (_, __, ___) => const SizedBox(
                        height: 120,
                        child: Center(child: Icon(Icons.broken_image_outlined)),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextButton(
                    onPressed: () => Navigator.of(dialogContext).pop(),
                    child: const Text('Đóng'),
                  ),
                ],
              ),
            ),
          ),
        );
      },
      transitionBuilder: (context, animation, secondaryAnimation, child) {
        final curved = CurvedAnimation(
          parent: animation,
          curve: Curves.easeOutBack,
        );
        return FadeTransition(
          opacity: animation,
          child: ScaleTransition(scale: curved, child: child),
        );
      },
    );
  }
}
