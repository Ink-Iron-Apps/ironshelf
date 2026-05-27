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
