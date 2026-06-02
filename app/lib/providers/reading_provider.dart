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
