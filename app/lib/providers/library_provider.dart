import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/library.dart';
import '../services/api_service.dart';
import 'server_provider.dart';

/// Async provider for the libraries list.
final librariesProvider =
    AsyncNotifierProvider<LibrariesNotifier, List<Library>>(
        LibrariesNotifier.new);

/// Currently selected library ID.
final selectedLibraryIdProvider = StateProvider<String?>((ref) => null);

/// Currently selected library object.
final selectedLibraryProvider = Provider<Library?>((ref) {
  final librariesAsync = ref.watch(librariesProvider);
  final selectedId = ref.watch(selectedLibraryIdProvider);
  if (selectedId == null) return null;
  return librariesAsync.valueOrNull
      ?.where((library) => library.id == selectedId)
      .firstOrNull;
});

class LibrariesNotifier extends AsyncNotifier<List<Library>> {
  @override
  Future<List<Library>> build() async {
    final apiService = ref.read(apiServiceProvider);
    return apiService.getLibraries();
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final apiService = ref.read(apiServiceProvider);
      return apiService.getLibraries();
    });
  }

  Future<void> scanLibrary(String libraryId) async {
    final apiService = ref.read(apiServiceProvider);
    await apiService.scanLibrary(libraryId);
  }
}
