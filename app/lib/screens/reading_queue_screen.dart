import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../widgets/empty_state.dart';

/// Reading queue / want-to-read list.
/// This maps to a special collection named "Want to Read" stored on the server.
class ReadingQueueScreen extends ConsumerWidget {
  const ReadingQueueScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('Reading Queue')),
      body: const EmptyState(
        icon: Icons.queue_rounded,
        title: 'Your reading queue is empty',
        subtitle:
            'Add books from the book detail screen to build your reading list.',
      ),
    );
  }
}
