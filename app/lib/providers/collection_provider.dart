import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';
import 'server_provider.dart';

/// All collections.
final collectionsProvider =
    AsyncNotifierProvider<CollectionsNotifier, List<CollectionSummary>>(
        CollectionsNotifier.new);

class CollectionsNotifier extends AsyncNotifier<List<CollectionSummary>> {
  @override
  Future<List<CollectionSummary>> build() async {
    final apiService = ref.read(apiServiceProvider);
    return apiService.getCollections();
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final apiService = ref.read(apiServiceProvider);
      return apiService.getCollections();
    });
  }

  Future<void> createCollection({
    required String name,
    String? description,
    bool isPublic = false,
  }) async {
    final apiService = ref.read(apiServiceProvider);
    await apiService.createCollection(
      name: name,
      description: description,
      isPublic: isPublic,
    );
    await refresh();
  }

  Future<void> deleteCollection(String collectionId) async {
    final apiService = ref.read(apiServiceProvider);
    await apiService.deleteCollection(collectionId);
    await refresh();
  }
}

/// Collection detail by ID.
final collectionDetailProvider = FutureProvider.family
    .autoDispose<CollectionDetail, String>((ref, collectionId) {
  final apiService = ref.read(apiServiceProvider);
  return apiService.getCollectionDetail(collectionId);
});
