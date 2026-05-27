import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../models/book.dart';
import '../providers/server_provider.dart';
import '../services/api_service.dart';
import '../widgets/book_card.dart';
import '../widgets/error_state.dart';
import '../widgets/loading_skeleton.dart';

/// Genre books provider.
final genreBooksProvider = FutureProvider.family
    .autoDispose<PaginatedResponse<Book>, ({String genreName, int page})>(
        (ref, params) {
  final apiService = ref.read(apiServiceProvider);
  return apiService.getGenreBooks(
    params.genreName,
    page: params.page,
    perPage: 30,
  );
});

class GenreDetailScreen extends ConsumerStatefulWidget {
  final String genreName;

  const GenreDetailScreen({super.key, required this.genreName});

  @override
  ConsumerState<GenreDetailScreen> createState() =>
      _GenreDetailScreenState();
}

class _GenreDetailScreenState extends ConsumerState<GenreDetailScreen> {
  int _currentPage = 1;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final decodedName = Uri.decodeComponent(widget.genreName);
    final booksAsync = ref.watch(genreBooksProvider(
        (genreName: decodedName, page: _currentPage)));

    return Scaffold(
      appBar: AppBar(title: Text(decodedName)),
      body: booksAsync.when(
        loading: () => const BookGridSkeleton(count: 12),
        error: (error, stack) => ErrorState(
          message: 'Could not load books',
          onRetry: () => ref.invalidate(genreBooksProvider(
              (genreName: decodedName, page: _currentPage))),
        ),
        data: (paginated) {
          final books = paginated.items;
          if (books.isEmpty) {
            return Center(
              child: Text(
                'No books in this genre',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            );
          }

          return Column(
            children: [
              Expanded(
                child: GridView.builder(
                  padding: const EdgeInsets.all(16),
                  gridDelegate:
                      const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 3,
                    childAspectRatio: 0.55,
                    crossAxisSpacing: 12,
                    mainAxisSpacing: 16,
                  ),
                  itemCount: books.length,
                  itemBuilder: (context, index) {
                    final book = books[index];
                    return BookCard(
                      book: book,
                      onTap: () => context.go('/book/${book.id}'),
                    );
                  },
                ),
              ),
              if (paginated.totalPages > 1)
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      IconButton(
                        onPressed: _currentPage > 1
                            ? () => setState(() => _currentPage--)
                            : null,
                        icon: const Icon(Icons.chevron_left),
                      ),
                      Text(
                        'Page $_currentPage of ${paginated.totalPages}',
                        style: theme.textTheme.bodySmall,
                      ),
                      IconButton(
                        onPressed: paginated.hasMore
                            ? () => setState(() => _currentPage++)
                            : null,
                        icon: const Icon(Icons.chevron_right),
                      ),
                    ],
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}
