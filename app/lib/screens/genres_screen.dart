import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/server_provider.dart';
import '../services/api_service.dart';
import '../widgets/error_state.dart';
import '../widgets/genre_chip.dart';
import '../widgets/loading_skeleton.dart';

/// Provider for all genres.
final allGenresProvider =
    FutureProvider.autoDispose<List<GenreEntry>>((ref) {
  final apiService = ref.read(apiServiceProvider);
  return apiService.getAllGenres();
});

class GenresScreen extends ConsumerWidget {
  const GenresScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final genresAsync = ref.watch(allGenresProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Genres')),
      body: genresAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stack) => ErrorState(
          message: 'Could not load genres',
          onRetry: () => ref.invalidate(allGenresProvider),
        ),
        data: (genres) {
          if (genres.isEmpty) {
            return Center(
              child: Text(
                'No genres found',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            );
          }

          return SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: genres.map((genre) {
                return GenreChip(
                  name: genre.name,
                  bookCount: genre.bookCount,
                  onTap: () => context.go(
                    '/genre/${Uri.encodeComponent(genre.name)}',
                  ),
                );
              }).toList(),
            ),
          );
        },
      ),
    );
  }
}
