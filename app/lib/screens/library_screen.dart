import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/library_provider.dart';
import '../widgets/empty_state.dart';
import '../widgets/error_state.dart';
import '../widgets/loading_skeleton.dart';

class LibraryListScreen extends ConsumerWidget {
  const LibraryListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final libraries = ref.watch(librariesProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Libraries')),
      body: libraries.when(
        loading: () => const ListSkeleton(count: 5),
        error: (error, stack) => ErrorState(
          message: 'Could not load libraries',
          onRetry: () => ref.invalidate(librariesProvider),
        ),
        data: (libraryList) {
          if (libraryList.isEmpty) {
            return const EmptyState(
              icon: Icons.library_books_outlined,
              title: 'No libraries',
              subtitle:
                  'Create a library on your server to start browsing.',
            );
          }

          return ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: libraryList.length,
            itemBuilder: (context, index) {
              final library = libraryList[index];
              return Card(
                margin: const EdgeInsets.only(bottom: 10),
                child: InkWell(
                  onTap: () => context.go('/library/${library.id}'),
                  borderRadius: BorderRadius.circular(12),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        Container(
                          width: 48,
                          height: 48,
                          decoration: BoxDecoration(
                            color: theme.colorScheme.primaryContainer,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Icon(
                            _libraryIcon(library.libraryType),
                            color: theme.colorScheme.onPrimaryContainer,
                          ),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                library.name,
                                style: theme.textTheme.titleSmall,
                              ),
                              const SizedBox(height: 4),
                              Row(
                                children: [
                                  _TypeChip(label: library.libraryType),
                                  const SizedBox(width: 6),
                                  _TypeChip(label: library.sourceKind),
                                ],
                              ),
                            ],
                          ),
                        ),
                        Icon(
                          Icons.chevron_right,
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ],
                    ),
                  ),
                ),
              );
            },
          );
        },
      ),
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

class _TypeChip extends StatelessWidget {
  final String label;

  const _TypeChip({required this.label});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        label,
        style: theme.textTheme.labelSmall?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
        ),
      ),
    );
  }
}
