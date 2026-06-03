import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../providers/reading_provider.dart';
import '../providers/server_provider.dart';
import '../widgets/empty_state.dart';
import '../widgets/error_state.dart';

/// The user's highlights and bookmarks across all books.
class AnnotationsScreen extends ConsumerWidget {
  const AnnotationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Highlights & Bookmarks'),
          bottom: const TabBar(
            tabs: [Tab(text: 'Highlights'), Tab(text: 'Bookmarks')],
          ),
        ),
        body: const TabBarView(
          children: [_HighlightsTab(), _BookmarksTab()],
        ),
      ),
    );
  }
}

class _HighlightsTab extends ConsumerWidget {
  const _HighlightsTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final highlightsAsync = ref.watch(allHighlightsProvider);

    return highlightsAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (_, __) => ErrorState(
        message: 'Could not load highlights',
        onRetry: () => ref.invalidate(allHighlightsProvider),
      ),
      data: (highlights) {
        if (highlights.isEmpty) {
          return const EmptyState(
            icon: Icons.format_quote_rounded,
            title: 'No highlights yet',
            subtitle: 'Select text while reading an EPUB to highlight it.',
          );
        }
        return RefreshIndicator(
          onRefresh: () async => ref.invalidate(allHighlightsProvider),
          child: ListView.separated(
            itemCount: highlights.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (context, index) {
              final highlight = highlights[index];
              return ListTile(
                leading: Icon(Icons.circle,
                    size: 14, color: _color(highlight.color)),
                title: Text(highlight.textContent ?? '(no text)',
                    maxLines: 3, overflow: TextOverflow.ellipsis),
                subtitle: highlight.note != null && highlight.note!.isNotEmpty
                    ? Text(highlight.note!,
                        style: theme.textTheme.bodySmall
                            ?.copyWith(fontStyle: FontStyle.italic))
                    : null,
                trailing: IconButton(
                  icon: const Icon(Icons.delete_outline, size: 20),
                  onPressed: () async {
                    await ref
                        .read(apiServiceProvider)
                        .deleteHighlight(highlight.id);
                    ref.invalidate(allHighlightsProvider);
                  },
                ),
                onTap: () => context.push('/book/${highlight.bookId}'),
              );
            },
          ),
        );
      },
    );
  }

  Color _color(String name) {
    switch (name) {
      case 'green':
        return Colors.green;
      case 'blue':
        return Colors.blue;
      case 'pink':
        return Colors.pink;
      case 'orange':
        return Colors.orange;
      case 'yellow':
      default:
        return Colors.amber;
    }
  }
}

class _BookmarksTab extends ConsumerWidget {
  const _BookmarksTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bookmarksAsync = ref.watch(allBookmarksProvider);

    return bookmarksAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (_, __) => ErrorState(
        message: 'Could not load bookmarks',
        onRetry: () => ref.invalidate(allBookmarksProvider),
      ),
      data: (bookmarks) {
        if (bookmarks.isEmpty) {
          return const EmptyState(
            icon: Icons.bookmark_border_rounded,
            title: 'No bookmarks yet',
            subtitle: 'Bookmark a spot while reading to find it here.',
          );
        }
        return RefreshIndicator(
          onRefresh: () async => ref.invalidate(allBookmarksProvider),
          child: ListView.separated(
            itemCount: bookmarks.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (context, index) {
              final bookmark = bookmarks[index];
              return ListTile(
                leading: const Icon(Icons.bookmark, size: 20),
                title: Text(
                  bookmark.note?.isNotEmpty == true
                      ? bookmark.note!
                      : 'Bookmark',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                trailing: IconButton(
                  icon: const Icon(Icons.delete_outline, size: 20),
                  onPressed: () async {
                    await ref
                        .read(apiServiceProvider)
                        .deleteBookmark(bookmark.bookId, bookmark.id);
                    ref.invalidate(allBookmarksProvider);
                  },
                ),
                onTap: () => context.push('/book/${bookmark.bookId}'),
              );
            },
          ),
        );
      },
    );
  }
}
