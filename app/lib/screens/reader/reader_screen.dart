import 'package:flutter/material.dart';

import 'cbz_reader_screen.dart';
import 'epub_reader_screen.dart';
import 'pdf_reader_screen.dart';

/// Routes a book to the right reader based on its format. Mirrors the web
/// reader's format detection (epub | pdf | cbz/cbr/cb7).
class ReaderScreen extends StatelessWidget {
  final int bookId;

  /// The actual format string chosen on the detail page (e.g. "EPUB", "CBR").
  final String format;

  const ReaderScreen({super.key, required this.bookId, required this.format});

  @override
  Widget build(BuildContext context) {
    final normalized = format.toLowerCase();
    if (normalized == 'pdf') {
      return PdfReaderScreen(bookId: bookId, format: format);
    }
    if (normalized == 'cbz' || normalized == 'cbr' || normalized == 'cb7') {
      return CbzReaderScreen(bookId: bookId, format: format);
    }
    // EPUB and anything epub-like.
    return EpubReaderScreen(bookId: bookId, format: format);
  }
}
