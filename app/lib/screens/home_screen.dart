import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/collection_provider.dart';
import '../providers/library_provider.dart';
import '../providers/reading_provider.dart';
import '../theme.dart';
import '../widgets/book_cover.dart';
import '../widgets/empty_state.dart';
import '../widgets/error_state.dart';
import '../widgets/loading_skeleton.dart';
import '../widgets/progress_bar.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(continueReadingProvider);
          ref.invalidate(collectionsProvider);
          ref.invalidate(librariesProvider);
        },
        child: CustomScrollView(
          slivers: [
            SliverAppBar(
              floating: true,
              title: Row(
                children: [
                  Icon(Icons.shelves, color: IronshelfColors.tealBright, size: 24),
                  const SizedBox(width: 10),
                  Text('Ironshelf',
                      style: theme.textTheme.titleLarge?.copyWith(
                        color: IronshelfColors.paper,
                      )),
                ],
              ),
              actions: [
                IconButton(
                  icon: const Icon(Icons.search),
                  onPressed: () => context.go('/search'),
                ),
                IconButton(
                  icon: const Icon(Icons.settings_outlined),
                  onPressed: () => context.go('/settings'),
                ),
              ],
            ),

            // Continue Reading
            SliverToBoxAdapter(
              child: _ContinueReadingSection(),
            ),

            // Collections
            SliverToBoxAdapter(
              child: _CollectionsSection(),
            ),

            // Libraries quick access
            SliverToBoxAdapter(
              child: _LibrariesSection(),
            ),

            // Bottom padding
            const SliverPadding(padding: EdgeInsets.only(bottom: 80)),
          ],
        ),
      ),
    );
  }
}

class _ContinueReadingSection extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final continueReading = ref.watch(continueReadingProvider);

    return continueReading.when(
      loading: () => Padding(
        padding: const EdgeInsets.only(top: 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text('Continue Reading',
                  style: theme.textTheme.titleMedium),
            ),
            const SizedBox(height: 12),
            const HorizontalBookSkeleton(count: 4),
          ],
        ),
      ),
      error: (error, stack) => const SizedBox.shrink(),
      data: (entries) {
        if (entries.isEmpty) return const SizedBox.shrink();

        return Padding(
          padding: const EdgeInsets.only(top: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Text('Continue Reading',
                    style: theme.textTheme.titleMedium),
              ),
              const SizedBox(height: 12),
              SizedBox(
                height: 210,
                child: ListView.builder(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  itemCount: entries.length,
                  itemBuilder: (context, index) {
                    final entry = entries[index];
                    return Padding(
                      padding: const EdgeInsets.only(right: 12),
                      child: SizedBox(
                        width: 120,
                        child: GestureDetector(
                          onTap: () => context.push(
                              '/read/${entry.book.id}/${entry.progress.format.toLowerCase()}'),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Stack(
                                children: [
                                  BookCover(
                                    bookId: entry.book.id,
                                    hasCover: entry.book.hasCover,
                                    title: entry.book.title,
                                    width: 120,
                                    height: 165,
                                    heroTag:
                                        'book_cover_${entry.book.id}',
                                  ),
                                  Positioned(
                                    bottom: 0,
                                    left: 0,
                                    right: 0,
                                    child: ReadingProgressBar(
                                      percent: entry.progress.percent,
                                      height: 3,
                                      borderRadius:
                                          const BorderRadius.only(
                                        bottomLeft: Radius.circular(8),
                                        bottomRight: Radius.circular(8),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 6),
                              Text(
                                entry.book.title,
                                style: theme.textTheme.bodySmall?.copyWith(
                                  fontWeight: FontWeight.w500,
                                ),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _CollectionsSection extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final collections = ref.watch(collectionsProvider);

    return collections.when(
      loading: () => const SizedBox.shrink(),
      error: (error, stack) => const SizedBox.shrink(),
      data: (collectionsList) {
        if (collectionsList.isEmpty) return const SizedBox.shrink();

        return Padding(
          padding: const EdgeInsets.only(top: 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Collections',
                        style: theme.textTheme.titleMedium),
                    TextButton(
                      onPressed: () => context.go('/collections'),
                      child: const Text('See all'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              SizedBox(
                height: 80,
                child: ListView.builder(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  itemCount: collectionsList.length,
                  itemBuilder: (context, index) {
                    final collection = collectionsList[index];
                    return Padding(
                      padding: const EdgeInsets.only(right: 10),
                      child: Material(
                        color: theme.colorScheme.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(12),
                        child: InkWell(
                          onTap: () =>
                              context.go('/collection/${collection.id}'),
                          borderRadius: BorderRadius.circular(12),
                          child: Container(
                            width: 160,
                            padding: const EdgeInsets.all(12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Text(
                                  collection.name,
                                  style: theme.textTheme.bodyMedium
                                      ?.copyWith(
                                          fontWeight: FontWeight.w500),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                if (collection.description != null) ...[
                                  const SizedBox(height: 2),
                                  Text(
                                    collection.description!,
                                    style: theme.textTheme.labelSmall
                                        ?.copyWith(
                                      color: theme
                                          .colorScheme.onSurfaceVariant,
                                    ),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _LibrariesSection extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final libraries = ref.watch(librariesProvider);

    return libraries.when(
      loading: () => const Padding(
        padding: EdgeInsets.all(16),
        child: ListSkeleton(count: 3),
      ),
      error: (error, stack) => Padding(
        padding: const EdgeInsets.all(16),
        child: ErrorState(
          message: 'Could not load libraries',
          onRetry: () => ref.invalidate(librariesProvider),
        ),
      ),
      data: (libraryList) {
        if (libraryList.isEmpty) {
          return const Padding(
            padding: EdgeInsets.all(32),
            child: EmptyState(
              icon: Icons.library_books_outlined,
              title: 'No libraries yet',
              subtitle:
                  'Add a library in your server dashboard to get started.',
            ),
          );
        }

        return Padding(
          padding: const EdgeInsets.only(top: 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Libraries',
                        style: theme.textTheme.titleMedium),
                    TextButton(
                      onPressed: () => context.go('/libraries'),
                      child: const Text('Browse all'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              ...libraryList.map((library) => ListTile(
                    leading: Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: theme.colorScheme.primaryContainer,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Icon(
                        _libraryIcon(library.libraryType),
                        color: theme.colorScheme.onPrimaryContainer,
                        size: 20,
                      ),
                    ),
                    title: Text(library.name),
                    subtitle: Text(
                      '${library.libraryType} · ${library.sourceKind}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    trailing: const Icon(Icons.chevron_right, size: 20),
                    onTap: () => context.go('/library/${library.id}'),
                  )),
            ],
          ),
        );
      },
    );
  }

  IconData _libraryIcon(String libraryType) {
    switch (libraryType.toLowerCase()) {
      case 'comic':
      case 'manga':
        return Icons.collections_bookmark_rounded;
      case 'fanfiction':
        return Icons.edit_note_rounded;
      default:
        return Icons.menu_book_rounded;
    }
  }
}
