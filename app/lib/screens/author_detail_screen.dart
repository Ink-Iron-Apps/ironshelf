import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';
import '../providers/browse_provider.dart';
import '../providers/reading_provider.dart';
import '../providers/server_provider.dart';
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
                      _AuthorAvatar(
                        authorId: authorId,
                        initials: _initials(authorDetail.author.name),
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

              // Bio / dates / external links (lazy-loaded)
              SliverToBoxAdapter(
                child: _AuthorInfoSection(authorId: authorId),
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

/// Circular author avatar — server-cached portrait over an initials fallback.
class _AuthorAvatar extends ConsumerWidget {
  final int authorId;
  final String initials;
  const _AuthorAvatar({required this.authorId, required this.initials});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final api = ref.read(apiServiceProvider);
    return ClipOval(
      child: Container(
        width: 64,
        height: 64,
        color: theme.colorScheme.primaryContainer,
        child: Stack(
          fit: StackFit.expand,
          children: [
            Center(
              child: Text(initials,
                  style: theme.textTheme.titleLarge?.copyWith(
                    color: theme.colorScheme.onPrimaryContainer,
                  )),
            ),
            CachedNetworkImage(
              imageUrl: api.authorPhotoUrl(authorId),
              httpHeaders: api.authHeaders,
              fit: BoxFit.cover,
              fadeInDuration: const Duration(milliseconds: 200),
              errorWidget: (_, __, ___) => const SizedBox.shrink(),
            ),
          ],
        ),
      ),
    );
  }
}

/// Author biography, life dates, and external links — shown only when present.
class _AuthorInfoSection extends ConsumerWidget {
  final int authorId;
  const _AuthorInfoSection({required this.authorId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final infoAsync = ref.watch(authorInfoProvider(authorId));

    return infoAsync.maybeWhen(
      orElse: () => const SizedBox.shrink(),
      data: (info) {
        if (!info.hasContent) return const SizedBox.shrink();
        final dates = [info.birthDate, info.deathDate]
            .where((d) => d != null && d.isNotEmpty)
            .join(' – ');
        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (dates.isNotEmpty)
                Text(dates,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    )),
              if (info.bio != null && info.bio!.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(info.bio!,
                    style: theme.textTheme.bodyMedium?.copyWith(height: 1.5)),
              ],
              if (info.openlibraryUrl != null || info.wikipediaUrl != null) ...[
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  children: [
                    if (info.wikipediaUrl != null)
                      OutlinedButton.icon(
                        onPressed: () => launchUrl(
                          Uri.parse(info.wikipediaUrl!),
                          mode: LaunchMode.externalApplication,
                        ),
                        icon: const Icon(Icons.public, size: 16),
                        label: const Text('Wikipedia'),
                      ),
                    if (info.openlibraryUrl != null)
                      OutlinedButton.icon(
                        onPressed: () => launchUrl(
                          Uri.parse(info.openlibraryUrl!),
                          mode: LaunchMode.externalApplication,
                        ),
                        icon: const Icon(Icons.menu_book_outlined, size: 16),
                        label: const Text('Open Library'),
                      ),
                  ],
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}
