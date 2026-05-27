import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/browse_provider.dart';
import '../widgets/book_card.dart';
import '../widgets/error_state.dart';
import '../widgets/loading_skeleton.dart';
import '../widgets/series_tile.dart';

class AuthorDetailScreen extends ConsumerWidget {
  final int authorId;

  const AuthorDetailScreen({super.key, required this.authorId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final authorDetailAsync = ref.watch(authorDetailProvider(authorId));
    final standaloneAsync = ref.watch(authorStandaloneBooksProvider(authorId));

    return authorDetailAsync.when(
      loading: () => Scaffold(
        appBar: AppBar(),
        body: const Center(child: CircularProgressIndicator()),
      ),
      error: (error, stack) => Scaffold(
        appBar: AppBar(),
        body: ErrorState(
          message: 'Could not load author',
          onRetry: () => ref.invalidate(authorDetailProvider(authorId)),
        ),
      ),
      data: (authorDetail) {
        return Scaffold(
          body: CustomScrollView(
            slivers: [
              SliverAppBar(
                floating: true,
                title: Text(authorDetail.author.name),
              ),

              // Author info header
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                  child: Row(
                    children: [
                      Container(
                        width: 64,
                        height: 64,
                        decoration: BoxDecoration(
                          color: theme.colorScheme.primaryContainer,
                          borderRadius: BorderRadius.circular(32),
                        ),
                        child: Center(
                          child: Text(
                            _initials(authorDetail.author.name),
                            style: theme.textTheme.titleLarge?.copyWith(
                              color: theme.colorScheme.onPrimaryContainer,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 16),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${authorDetail.author.bookCount} books',
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                          Text(
                            '${authorDetail.series.length} series · ${authorDetail.standaloneCount} standalone',
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),

              // Series section
              if (authorDetail.series.isNotEmpty) ...[
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                    child: Text('Series',
                        style: theme.textTheme.titleSmall),
                  ),
                ),
                SliverList(
                  delegate: SliverChildBuilderDelegate(
                    (context, index) {
                      final series = authorDetail.series[index];
                      return SeriesTile(
                        series: series,
                        onTap: () => context.go('/series/${series.id}'),
                      );
                    },
                    childCount: authorDetail.series.length,
                  ),
                ),
              ],

              // Standalone books section
              if (authorDetail.standaloneCount > 0)
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                    child: Text('Standalone Books',
                        style: theme.textTheme.titleSmall),
                  ),
                ),

              if (authorDetail.standaloneCount > 0)
                standaloneAsync.when(
                  loading: () => const SliverToBoxAdapter(
                    child: BookGridSkeleton(count: 6),
                  ),
                  error: (error, stack) => SliverToBoxAdapter(
                    child: ErrorState(
                      message: 'Could not load standalone books',
                      onRetry: () => ref.invalidate(
                          authorStandaloneBooksProvider(authorId)),
                    ),
                  ),
                  data: (books) {
                    return SliverPadding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      sliver: SliverGrid(
                        delegate: SliverChildBuilderDelegate(
                          (context, index) {
                            final book = books[index];
                            return BookCard(
                              book: book,
                              onTap: () =>
                                  context.go('/book/${book.id}'),
                            );
                          },
                          childCount: books.length,
                        ),
                        gridDelegate:
                            const SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: 3,
                          childAspectRatio: 0.55,
                          crossAxisSpacing: 12,
                          mainAxisSpacing: 16,
                        ),
                      ),
                    );
                  },
                ),

              const SliverPadding(padding: EdgeInsets.only(bottom: 32)),
            ],
          ),
        );
      },
    );
  }

  String _initials(String name) {
    final trimmed = name.trim();
    if (trimmed.isEmpty) return '?';
    final parts = trimmed.split(RegExp(r'\s+'));
    if (parts.length >= 2) {
      return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
    }
    return trimmed[0].toUpperCase();
  }
}
