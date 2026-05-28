import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ironshelf/widgets/empty_state.dart';

void main() {
  testWidgets('EmptyState displays title and subtitle', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: EmptyState(
            icon: Icons.library_books_outlined,
            title: 'No libraries',
            subtitle: 'Create a library to start browsing.',
          ),
        ),
      ),
    );

    expect(find.text('No libraries'), findsOneWidget);
    expect(find.text('Create a library to start browsing.'), findsOneWidget);
    expect(find.byIcon(Icons.library_books_outlined), findsOneWidget);
  });

  testWidgets('EmptyState shows action button when provided', (tester) async {
    var wasPressed = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: EmptyState(
            icon: Icons.add,
            title: 'Empty',
            actionLabel: 'Add item',
            onAction: () => wasPressed = true,
          ),
        ),
      ),
    );

    expect(find.text('Add item'), findsOneWidget);
    await tester.tap(find.text('Add item'));
    expect(wasPressed, isTrue);
  });
}
