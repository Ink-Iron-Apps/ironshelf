import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';
import 'server_provider.dart';

/// Current search query.
final searchQueryProvider = StateProvider<String>((ref) => '');

/// Search results provider — auto-refreshes on query change.
final searchResultsProvider =
    AsyncNotifierProvider<SearchResultsNotifier, SearchResults?>(
        SearchResultsNotifier.new);

class SearchResultsNotifier extends AsyncNotifier<SearchResults?> {
  Timer? _debounceTimer;

  @override
  Future<SearchResults?> build() async {
    final query = ref.watch(searchQueryProvider);
    if (query.trim().isEmpty) return null;

    // Cancel any pending debounce
    _debounceTimer?.cancel();

    // Debounce: wait 300ms before actually searching
    final completer = Completer<SearchResults?>();
    _debounceTimer = Timer(const Duration(milliseconds: 300), () async {
      try {
        final apiService = ref.read(apiServiceProvider);
        final results = await apiService.search(query.trim());
        if (!completer.isCompleted) completer.complete(results);
      } on ApiException catch (apiError) {
        if (!completer.isCompleted) completer.completeError(apiError);
      }
    });

    return completer.future;
  }
}
