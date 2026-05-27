import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/book.dart';
import '../providers/book_provider.dart';
import '../theme.dart';
import '../widgets/book_cover.dart';
import '../widgets/error_state.dart';
import '../widgets/rating_stars.dart';

class BookDetailScreen extends ConsumerWidget {
  final int bookId;

  const BookDetailScreen({super.key, required this.bookId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final bookAsync = ref.watch(bookDetailProvider(bookId));

    return bookAsync.when(
      loading: () => Scaffold(
        appBar: AppBar(),
        body: const Center(child: CircularProgressIndicator()),
      ),
      error: (error, stack) => Scaffold(
        appBar: AppBar(),
        body: ErrorState(
          message: 'Could not load book details',
          onRetry: () => ref.invalidate(bookDetailProvider(bookId)),
        ),
      ),
      data: (book) => Scaffold(body: _BookDetailContent(book: book)),
    );
  }
}

class _BookDetailContent extends ConsumerWidget {
  final Book book;

  const _BookDetailContent({required this.book});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);

    return CustomScrollView(
      slivers: [
        // Cover header
        SliverAppBar(
          expandedHeight: 300,
          pinned: true,
          flexibleSpace: FlexibleSpaceBar(
            background: Stack(
              fit: StackFit.expand,
              children: [
                // Blurred background
                if (book.hasCover)
                  BookCover(
                    bookId: book.id,
                    hasCover: book.hasCover,
                    width: double.infinity,
                    height: double.infinity,
                    borderRadius: BorderRadius.zero,
                  ),
                // Gradient overlay
                Container(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [
                        theme.scaffoldBackgroundColor.withValues(alpha: 0.3),
                        theme.scaffoldBackgroundColor,
                      ],
                    ),
                  ),
                ),
                // Cover centered
                Positioned(
                  bottom: 20,
                  left: 0,
                  right: 0,
                  child: Center(
                    child: BookCover(
                      bookId: book.id,
                      hasCover: book.hasCover,
                      title: book.title,
                      width: 140,
                      height: 200,
                      heroTag: 'book_cover_${book.id}',
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),

        // Title and metadata
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Text(
                  book.title,
                  style: theme.textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                  textAlign: TextAlign.center,
                ),
                if (book.seriesIndex != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      'Book #${_formatSeriesIndex(book.seriesIndex!)}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: IronshelfColors.tealBright,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                const SizedBox(height: 8),
                RatingStars(rating: book.rating, starSize: 20),
                const SizedBox(height: 16),

                // Action buttons
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    if (book.formats.isNotEmpty)
                      ElevatedButton.icon(
                        onPressed: () {
                          // Open reader or download
                          _showFormatPicker(context, ref, book);
                        },
                        icon: const Icon(Icons.menu_book_rounded, size: 18),
                        label: const Text('Read'),
                      ),
                    const SizedBox(width: 8),
                    OutlinedButton.icon(
                      onPressed: () => _showAddToCollectionSheet(context),
                      icon: const Icon(Icons.playlist_add, size: 18),
                      label: const Text('Add to collection'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),

        // Tags
        if (book.tags.isNotEmpty)
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
              child: Wrap(
                spacing: 6,
                runSpacing: 6,
                children: book.tags.map((tag) {
                  return Chip(
                    label: Text(tag),
                    visualDensity: VisualDensity.compact,
                    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  );
                }).toList(),
              ),
            ),
          ),

        // Description
        if (book.description != null && book.description!.isNotEmpty)
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Description',
                      style: theme.textTheme.titleSmall),
                  const SizedBox(height: 8),
                  Text(
                    _stripHtml(book.description!),
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                      height: 1.5,
                    ),
                  ),
                ],
              ),
            ),
          ),

        // Formats
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Formats', style: theme.textTheme.titleSmall),
                const SizedBox(height: 8),
                ...book.formats.map((format) {
                  return ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(
                      _formatIcon(format.kind),
                      size: 20,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                    title: Text(format.kind.toUpperCase()),
                    subtitle: format.size != null
                        ? Text(_formatFileSize(format.size!))
                        : null,
                    trailing: IconButton(
                      icon: const Icon(Icons.download_rounded, size: 20),
                      onPressed: () {
                        // Download via browser
                      },
                    ),
                  );
                }),
              ],
            ),
          ),
        ),

        // Metadata details
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Details', style: theme.textTheme.titleSmall),
                const SizedBox(height: 8),
                if (book.pubdate != null)
                  _DetailRow(label: 'Published', value: book.pubdate!),
                if (book.addedAt != null)
                  _DetailRow(label: 'Added', value: book.addedAt!),
                if (book.languages.isNotEmpty)
                  _DetailRow(
                      label: 'Language',
                      value: book.languages.join(', ')),
                if (book.identifiers.isNotEmpty)
                  ...book.identifiers.entries.map(
                    (entry) => _DetailRow(
                      label: entry.key.toUpperCase(),
                      value: entry.value,
                    ),
                  ),
              ],
            ),
          ),
        ),

        // Custom columns
        if (book.custom.isNotEmpty)
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Custom Fields',
                      style: theme.textTheme.titleSmall),
                  const SizedBox(height: 8),
                  ...book.custom.entries.map(
                    (entry) => _DetailRow(
                      label: entry.key,
                      value: entry.value.toString(),
                    ),
                  ),
                ],
              ),
            ),
          ),

        const SliverPadding(padding: EdgeInsets.only(bottom: 80)),
      ],
    );
  }

  void _showFormatPicker(BuildContext context, WidgetRef ref, Book book) {
    if (book.formats.length == 1) {
      // Single format — open directly
      return;
    }

    showModalBottomSheet(
      context: context,
      builder: (context) {
        final theme = Theme.of(context);
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 20, 20, 12),
                child: Text('Choose format',
                    style: theme.textTheme.titleSmall),
              ),
              ...book.formats.map((format) {
                return ListTile(
                  leading: Icon(_formatIcon(format.kind)),
                  title: Text(format.kind.toUpperCase()),
                  subtitle: format.size != null
                      ? Text(_formatFileSize(format.size!))
                      : null,
                  onTap: () {
                    Navigator.pop(context);
                    // Open reader for this format
                  },
                );
              }),
              const SizedBox(height: 8),
            ],
          ),
        );
      },
    );
  }

  void _showAddToCollectionSheet(BuildContext context) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Collection feature coming soon')),
    );
  }

  String _formatSeriesIndex(double index) {
    if (index == index.roundToDouble()) {
      return index.toInt().toString();
    }
    return index.toString();
  }

  String _stripHtml(String html) {
    return html.replaceAll(RegExp(r'<[^>]*>'), '').trim();
  }

  IconData _formatIcon(String kind) {
    switch (kind.toUpperCase()) {
      case 'EPUB':
        return Icons.book_rounded;
      case 'PDF':
        return Icons.picture_as_pdf_rounded;
      case 'CBZ':
      case 'CBR':
        return Icons.image_rounded;
      case 'MOBI':
        return Icons.phone_android_rounded;
      default:
        return Icons.insert_drive_file_rounded;
    }
  }

  String _formatFileSize(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
}

class _DetailRow extends StatelessWidget {
  final String label;
  final String value;

  const _DetailRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 100,
            child: Text(
              label,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: theme.textTheme.bodySmall,
            ),
          ),
        ],
      ),
    );
  }
}
