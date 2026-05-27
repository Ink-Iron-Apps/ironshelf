import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';
import 'server_provider.dart';

/// Current search query.
final searchQueryProvider = StateProvider<String>((ref) => '');

/// Search results provider -- auto-refreshes on query change.
final searchResultsProvider =
    AsyncNotifierProvider<SearchResultsNotifier, SearchResults?>(
        SearchResultsNotifier.new);

class SearchResultsNotifier extends AsyncNotifier<SearchResults?> {
  Timer? _debounceTimer;

  @override
  Future<SearchResults?> build() async {
    final query = ref.watch(searchQueryProvider);
    if (query.trim().isEmpty) return null;

    // Cancel any pending debounce from a previous build cycle.
    _debounceTimer?.cancel();

    // Capture the API service reference synchronously before the timer fires,
    // so we don't read from a potentially stale ref inside the async callback.
    final apiService = ref.read(apiServiceProvider);
    final trimmedQuery = query.trim();

    // Debounce: wait 300ms before actually searching.
    final completer = Completer<SearchResults?>();
    _debounceTimer = Timer(const Duration(milliseconds: 300), () async {
      try {
        final results = await apiService.search(trimmedQuery);
        if (!completer.isCompleted) completer.complete(results);
      } on ApiException catch (apiError) {
        if (!completer.isCompleted) completer.completeError(apiError);
      } catch (error) {
        if (!completer.isCompleted) {
          completer.completeError(
            ApiException('Search failed: $error'),
          );
        }
      }
    });

    // Ensure the timer is cancelled if this provider is disposed/rebuilt
    // before the timer fires.
    ref.onDispose(() {
      _debounceTimer?.cancel();
      if (!completer.isCompleted) {
        completer.complete(null);
      }
    });

    return completer.future;
  }
}
