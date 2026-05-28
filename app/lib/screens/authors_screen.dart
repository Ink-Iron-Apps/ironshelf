import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../models/author.dart';
import '../providers/browse_provider.dart';
import '../widgets/alpha_sidebar.dart';
import '../widgets/author_tile.dart';
import '../widgets/error_state.dart';
import '../widgets/loading_skeleton.dart';

class AuthorsScreen extends ConsumerStatefulWidget {
  final String libraryId;

  const AuthorsScreen({super.key, required this.libraryId});

  @override
  ConsumerState<AuthorsScreen> createState() => _AuthorsScreenState();
}

class _AuthorsScreenState extends ConsumerState<AuthorsScreen> {
  final ScrollController _scrollController = ScrollController();
  String? _activeLetter;

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final authorsAsync = ref.watch(authorsProvider(AuthorsRequest(
      libraryId: widget.libraryId,
      page: 1,
      perPage: 5000, // Load all for alpha jump
    )));

    return Scaffold(
      appBar: AppBar(title: const Text('Authors')),
      body: authorsAsync.when(
        loading: () => const ListSkeleton(count: 12),
        error: (error, stack) => ErrorState(
          message: 'Could not load authors',
          onRetry: () => ref.invalidate(authorsProvider(AuthorsRequest(
            libraryId: widget.libraryId,
            page: 1,
            perPage: 5000,
          ))),
        ),
        data: (paginated) {
          final authors = paginated.items;
          if (authors.isEmpty) {
            return Center(
              child: Text('No authors found',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  )),
            );
          }

          // Build available letters
          final availableLetters = <String>{};
          for (final author in authors) {
            final firstChar = author.sortName.isNotEmpty
                ? author.sortName[0].toUpperCase()
                : '#';
            if (RegExp(r'[A-Z]').hasMatch(firstChar)) {
              availableLetters.add(firstChar);
            } else {
              availableLetters.add('#');
            }
          }

          return Row(
            children: [
              Expanded(
                child: ListView.builder(
                  controller: _scrollController,
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  itemCount: authors.length,
                  itemBuilder: (context, index) {
                    final author = authors[index];
                    return AuthorTile(
                      author: author,
                      onTap: () => context.go('/author/${author.id}'),
                    );
                  },
                ),
              ),
              AlphaSidebar(
                availableLetters: availableLetters.toList()..sort(),
                activeLetter: _activeLetter,
                onLetterTap: (letter) {
                  setState(() => _activeLetter = letter);
                  _scrollToLetter(letter, authors);
                },
              ),
            ],
          );
        },
      ),
    );
  }

  void _scrollToLetter(String letter, List<Author> authorsList) {
    int targetIndex = -1;
    for (int i = 0; i < authorsList.length; i++) {
      final author = authorsList[i];
      final firstChar = author.sortName.isNotEmpty
          ? author.sortName[0].toUpperCase()
          : '#';
      final authorLetter = RegExp(r'[A-Z]').hasMatch(firstChar)
          ? firstChar
          : '#';
      if (authorLetter == letter) {
        targetIndex = i;
        break;
      }
    }

    if (targetIndex >= 0) {
      // Estimate position (each tile is ~64px)
      final estimatedOffset = targetIndex * 64.0;
      _scrollController.animateTo(
        estimatedOffset.clamp(0.0, _scrollController.position.maxScrollExtent),
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOut,
      );
    }
  }
}
