import 'package:in_app_review/in_app_review.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Requests an in-app store review after a positive moment (finishing a book),
/// never on first launch and only once. The OS decides whether to actually show
/// the prompt — we only request it.
class ReviewService {
  static const _completedCountKey = 'review_completed_count';
  static const _requestedKey = 'review_requested';
  static const _threshold = 3;

  /// Call after a positive moment (e.g. marking a book read). Requests a review
  /// once the user has finished a few books, and at most once per install.
  static Future<void> recordPositiveMoment() async {
    final prefs = await SharedPreferences.getInstance();
    if (prefs.getBool(_requestedKey) ?? false) return;

    final count = (prefs.getInt(_completedCountKey) ?? 0) + 1;
    await prefs.setInt(_completedCountKey, count);
    if (count < _threshold) return;

    final inAppReview = InAppReview.instance;
    if (await inAppReview.isAvailable()) {
      await inAppReview.requestReview();
      await prefs.setBool(_requestedKey, true);
    }
  }
}
