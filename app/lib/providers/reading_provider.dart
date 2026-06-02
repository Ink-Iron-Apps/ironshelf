import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';
import 'server_provider.dart';

/// Continue reading list.
final continueReadingProvider =
    AsyncNotifierProvider<ContinueReadingNotifier, List<ContinueReadingEntry>>(
        ContinueReadingNotifier.new);

class ContinueReadingNotifier
    extends AsyncNotifier<List<ContinueReadingEntry>> {
  @override
  Future<List<ContinueReadingEntry>> build() async {
    final apiService = ref.read(apiServiceProvider);
    return apiService.getContinueReading();
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final apiService = ref.read(apiServiceProvider);
      return apiService.getContinueReading();
    });
  }
}

/// Progress for a specific book.
final bookProgressProvider = FutureProvider.family
    .autoDispose<List<ReadingProgress>, String>((ref, bookId) {
  final apiService = ref.read(apiServiceProvider);
  return apiService.getProgress(bookId);
});

/// The user's reading-state snapshot (in-progress percents + finished IDs).
/// Cached until invalidated (after a mark read/unread or returning from the
/// reader). Cards read this to overlay progress bars and finished badges.
final readingStatesProvider = FutureProvider<ReadingStates>((ref) {
  final apiService = ref.read(apiServiceProvider);
  return apiService.getReadingStates();
});

/// Ratings summary + the user's rating for a book.
final bookRatingsProvider =
    FutureProvider.family.autoDispose<BookRatings, String>((ref, bookId) {
  return ref.read(apiServiceProvider).getBookRatings(bookId);
});

/// Reviews for a book.
final bookReviewsProvider =
    FutureProvider.family.autoDispose<List<Review>, String>((ref, bookId) {
  return ref.read(apiServiceProvider).getBookReviews(bookId);
});

/// Author bio / dates / links.
final authorInfoProvider =
    FutureProvider.family.autoDispose<AuthorInfo, int>((ref, authorId) {
  return ref.read(apiServiceProvider).getAuthorInfo(authorId);
});

/// The user's reading queue.
final queueProvider =
    FutureProvider.autoDispose<List<QueueItem>>((ref) {
  return ref.read(apiServiceProvider).getQueue();
});

/// Yearly reading goal (nullable when unset).
final readingGoalProvider =
    FutureProvider.autoDispose<ReadingGoal?>((ref) {
  return ref.read(apiServiceProvider).getReadingGoal();
});

/// Personal reading stats (/me/stats).
final personalStatsProvider =
    FutureProvider.autoDispose<Map<String, dynamic>>((ref) {
  return ref.read(apiServiceProvider).getPersonalStats();
});

/// All notifications.
final notificationsProvider =
    FutureProvider.autoDispose<List<AppNotification>>((ref) {
  return ref.read(apiServiceProvider).getNotifications();
});

/// Unread notification count (for the bell badge).
final unreadNotificationCountProvider =
    FutureProvider.autoDispose<int>((ref) {
  return ref.read(apiServiceProvider).getUnreadNotificationCount();
});

/// All of the user's highlights across books.
final allHighlightsProvider =
    FutureProvider.autoDispose<List<HighlightEntry>>((ref) {
  return ref.read(apiServiceProvider).getAllHighlights();
});

/// All of the user's bookmarks across books.
final allBookmarksProvider =
    FutureProvider.autoDispose<List<BookmarkEntry>>((ref) {
  return ref.read(apiServiceProvider).getAllBookmarks();
});

/// Bookmarks for a specific book.
final bookBookmarksProvider = FutureProvider.family
    .autoDispose<List<BookmarkEntry>, String>((ref, bookId) {
  final apiService = ref.read(apiServiceProvider);
  return apiService.getBookmarks(bookId);
});

/// Highlights for a specific book.
final bookHighlightsProvider = FutureProvider.family
    .autoDispose<List<HighlightEntry>, String>((ref, bookId) {
  final apiService = ref.read(apiServiceProvider);
  return apiService.getBookHighlights(bookId);
});
