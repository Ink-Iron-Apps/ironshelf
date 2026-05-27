import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/book_provider.dart';
import '../providers/collection_provider.dart';
import '../widgets/book_cover.dart';
import '../widgets/empty_state.dart';
import '../widgets/error_state.dart';

class CollectionDetailScreen extends ConsumerWidget {
  final String collectionId;

  const CollectionDetailScreen({super.key, required this.collectionId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final detailAsync = ref.watch(collectionDetailProvider(collectionId));

    return detailAsync.when(
      loading: () => Scaffold(
        appBar: AppBar(),
        body: const Center(child: CircularProgressIndicator()),
      ),
      error: (error, stack) => Scaffold(
        appBar: AppBar(),
        body: ErrorState(
          message: 'Could not load collection',
          onRetry: () =>
              ref.invalidate(collectionDetailProvider(collectionId)),
        ),
      ),
      data: (detail) {
        return Scaffold(
          body: CustomScrollView(
            slivers: [
              SliverAppBar(
                floating: true,
                title: Text(detail.summary.name),
                actions: [
                  PopupMenuButton<String>(
                    onSelected: (value) async {
                      if (value == 'delete') {
                        final shouldDelete = await showDialog<bool>(
                          context: context,
                          builder: (dialogContext) => AlertDialog(
                            title: const Text('Delete collection?'),
                            content: Text(
                                'This will permanently delete "${detail.summary.name}".'),
                            actions: [
                              TextButton(
                                onPressed: () =>
                                    Navigator.pop(dialogContext, false),
                                child: const Text('Cancel'),
                              ),
                              TextButton(
                                onPressed: () =>
                                    Navigator.pop(dialogContext, true),
                                child: Text('Delete',
                                    style: TextStyle(
                                        color: theme.colorScheme.error)),
                              ),
                            ],
                          ),
                        );
                        if (shouldDelete == true && context.mounted) {
                          await ref
                              .read(collectionsProvider.notifier)
                              .deleteCollection(collectionId);
                          if (context.mounted) context.go('/collections');
                        }
                      }
                    },
                    itemBuilder: (context) => [
                      const PopupMenuItem(
                        value: 'delete',
                        child: Text('Delete collection'),
                      ),
                    ],
                  ),
                ],
              ),

              if (detail.summary.description != null)
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                    child: Text(
                      detail.summary.description!,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                ),

              if (detail.books.isEmpty)
                const SliverFillRemaining(
                  child: EmptyState(
                    icon: Icons.library_add_outlined,
                    title: 'No books yet',
                    subtitle:
                        'Add books from the book detail screen.',
                  ),
                ),

              if (detail.books.isNotEmpty)
                SliverList(
                  delegate: SliverChildBuilderDelegate(
                    (context, index) {
                      final entry = detail.books[index];
                      final bookId = int.tryParse(entry.bookId);
                      return ListTile(
                        leading: SizedBox(
                          width: 40,
                          height: 56,
                          child: bookId != null
                              ? BookCover(
                                  bookId: bookId,
                                  hasCover: true,
                                  borderRadius: BorderRadius.circular(4),
                                )
                              : Container(
                                  decoration: BoxDecoration(
                                    color: theme
                                        .colorScheme.surfaceContainerHighest,
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: const Icon(
                                      Icons.menu_book_rounded,
                                      size: 20),
                                ),
                        ),
                        title: Text('Book #${entry.bookId}'),
                        subtitle: Text('#${entry.position + 1} in collection'),
                        trailing: const Icon(Icons.chevron_right, size: 20),
                        onTap: bookId != null
                            ? () => context.go('/book/$bookId')
                            : null,
                      );
                    },
                    childCount: detail.books.length,
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}
