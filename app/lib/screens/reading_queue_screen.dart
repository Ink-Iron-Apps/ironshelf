import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../providers/reading_provider.dart';
import '../providers/server_provider.dart';
import '../widgets/book_cover.dart';
import '../widgets/empty_state.dart';
import '../widgets/error_state.dart';

/// Reading queue (want-to-read), backed by the server's /me/queue.
class ReadingQueueScreen extends ConsumerWidget {
  const ReadingQueueScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final queueAsync = ref.watch(queueProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Reading Queue')),
      body: queueAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => ErrorState(
          message: 'Could not load your queue',
          onRetry: () => ref.invalidate(queueProvider),
        ),
        data: (items) {
          if (items.isEmpty) {
            return const EmptyState(
              icon: Icons.queue_rounded,
              title: 'Your reading queue is empty',
              subtitle:
                  'Add books from the book screen to build your reading list.',
            );
          }
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(queueProvider),
            child: ListView.separated(
              itemCount: items.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final item = items[index];
                final bookId = int.tryParse(item.bookId) ?? 0;
                return Dismissible(
                  key: ValueKey(item.bookId),
                  direction: DismissDirection.endToStart,
                  background: Container(
                    color: theme.colorScheme.error,
                    alignment: Alignment.centerRight,
                    padding: const EdgeInsets.only(right: 20),
                    child: const Icon(Icons.delete, color: Colors.white),
                  ),
                  onDismissed: (_) async {
                    await ref
                        .read(apiServiceProvider)
                        .removeFromQueue(item.bookId);
                    ref.invalidate(queueProvider);
                  },
                  child: ListTile(
                    leading: BookCover(
                      bookId: bookId,
                      hasCover: item.hasCover,
                      title: item.title,
                      width: 40,
                      height: 58,
                      borderRadius: BorderRadius.circular(4),
                    ),
                    title: Text(item.title, maxLines: 1,
                        overflow: TextOverflow.ellipsis),
                    subtitle: item.authors.isEmpty
                        ? null
                        : Text(item.authors.join(', '),
                            maxLines: 1, overflow: TextOverflow.ellipsis),
                    trailing: PopupMenuButton<String>(
                      onSelected: (action) async {
                        final api = ref.read(apiServiceProvider);
                        if (action == 'up' || action == 'down') {
                          await api.moveQueueItem(item.bookId, action);
                        } else if (action == 'remove') {
                          await api.removeFromQueue(item.bookId);
                        }
                        ref.invalidate(queueProvider);
                      },
                      itemBuilder: (_) => const [
                        PopupMenuItem(value: 'up', child: Text('Move up')),
                        PopupMenuItem(value: 'down', child: Text('Move down')),
                        PopupMenuItem(value: 'remove', child: Text('Remove')),
                      ],
                    ),
                    onTap: () => context.push('/book/${item.bookId}'),
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }
}
