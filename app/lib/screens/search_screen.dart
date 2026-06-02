import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/search_provider.dart';
import '../widgets/book_cover.dart';
import '../widgets/empty_state.dart';
import '../widgets/error_state.dart';
import '../widgets/search_bar.dart' as custom;

class SearchScreen extends ConsumerWidget {
  const SearchScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final searchResults = ref.watch(searchResultsProvider);
    final query = ref.watch(searchQueryProvider);

    return Scaffold(
      appBar: AppBar(
        title: custom.DebouncedSearchBar(
          hintText: 'Search authors, series, books...',
          autofocus: true,
          onChanged: (value) {
            ref.read(searchQueryProvider.notifier).state = value;
          },
        ),
      ),
      body: query.isEmpty
          ? const EmptyState(
              icon: Icons.search_rounded,
              title: 'Search your library',
              subtitle: 'Find books, authors, and series across all libraries.',
            )
          : searchResults.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, stack) => ErrorState(
                message: 'Search failed',
                onRetry: () => ref.invalidate(searchResultsProvider),
              ),
              data: (results) {
                if (results == null) return const SizedBox.shrink();
                if (results.isEmpty) {
                  return EmptyState(
                    icon: Icons.search_off_rounded,
                    title: 'No results',
                    subtitle: 'No matches for "$query"',
                  );
                }

                return ListView(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  children: [
                    // Authors
                    if (results.authors.isNotEmpty) ...[
                      _SectionHeader(
                        title: 'Authors',
                        count: results.authors.length,
                      ),
                      ...results.authors.map((author) => ListTile(
                            leading: CircleAvatar(
                              backgroundColor:
                                  theme.colorScheme.primaryContainer,
                              child: Text(
                                author.name.isNotEmpty
                                    ? author.name[0].toUpperCase()
                                    : '?',
                                style: TextStyle(
                                  color:
                                      theme.colorScheme.onPrimaryContainer,
                                ),
                              ),
                            ),
                            title: Text(author.name),
                            subtitle: Text(
                              '${author.bookCount} books · ${author.seriesCount} series',
                            ),
                            onTap: () =>
                                context.go('/author/${author.id}'),
                          )),
                    ],

                    // Series
                    if (results.seriesResults.isNotEmpty) ...[
                      _SectionHeader(
                        title: 'Series',
                        count: results.seriesResults.length,
                      ),
                      ...results.seriesResults.map((series) => ListTile(
                            leading: Container(
                              width: 40,
                              height: 40,
                              decoration: BoxDecoration(
                                color: theme
                                    .colorScheme.secondaryContainer,
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Icon(
                                Icons.auto_stories_rounded,
                                color: theme
                                    .colorScheme.onSecondaryContainer,
                                size: 20,
                              ),
                            ),
                            title: Text(series.name),
                            subtitle: Text(
                                '${series.bookCount} books'),
                            onTap: () =>
                                context.go('/series/${series.id}'),
                          )),
                    ],

                    // Books
                    if (results.books.isNotEmpty) ...[
                      _SectionHeader(
                        title: 'Books',
                        count: results.books.length,
                      ),
                      ...results.books.map((book) => ListTile(
                            leading: SizedBox(
                              width: 40,
                              height: 56,
                              child: BookCover(
                                bookId: book.id,
                                hasCover: book.hasCover,
                                title: book.title,
                                borderRadius: BorderRadius.circular(4),
                              ),
                            ),
                            title: Text(book.title),
                            subtitle: book.tags.isNotEmpty
                                ? Text(
                                    book.tags.take(3).join(', '),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  )
                                : null,
                            onTap: () =>
                                context.go('/book/${book.id}'),
                          )),
                    ],
                  ],
                );
              },
            ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  final int count;

  const _SectionHeader({required this.title, required this.count});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
      child: Row(
        children: [
          Text(title, style: theme.textTheme.titleSmall),
          const SizedBox(width: 6),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Text(
              '$count',
              style: theme.textTheme.labelSmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
