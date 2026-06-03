import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pdfrx/pdfrx.dart';

import '../../providers/server_provider.dart';
import '../../theme.dart';

/// PDF reader built on pdfrx. Progress is tracked by page number; the locator
/// stored on the server is the 1-based page number as a string.
class PdfReaderScreen extends ConsumerStatefulWidget {
  final int bookId;
  final String format;

  const PdfReaderScreen({
    super.key,
    required this.bookId,
    required this.format,
  });

  @override
  ConsumerState<PdfReaderScreen> createState() => _PdfReaderScreenState();
}

class _PdfReaderScreenState extends ConsumerState<PdfReaderScreen> {
  final PdfViewerController _controller = PdfViewerController();

  bool _loading = true;
  String? _error;
  double _downloadProgress = 0;

  File? _bookFile;
  int _totalPages = 0;
  int _currentPage = 1;
  int? _restorePage;
  bool _chromeVisible = true;

  Timer? _saveDebounce;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  @override
  void dispose() {
    _saveDebounce?.cancel();
    super.dispose();
  }

  Future<void> _bootstrap() async {
    try {
      final api = ref.read(apiServiceProvider);

      try {
        final progressList = await api.getProgress(widget.bookId.toString());
        final match = progressList.where(
          (p) => p.format.toLowerCase() == widget.format.toLowerCase(),
        );
        if (match.isNotEmpty) {
          _restorePage = int.tryParse(match.first.locator ?? '');
        }
      } catch (_) {}

      final file = await api.downloadBookFile(
        widget.bookId,
        widget.format,
        onProgress: (received, total) {
          if (total > 0 && mounted) {
            setState(() => _downloadProgress = received / total);
          }
        },
      );

      if (!mounted) return;
      setState(() {
        _bookFile = file;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Failed to open PDF: $e';
        _loading = false;
      });
    }
  }

  void _onPageChanged(int? pageNumber) {
    if (pageNumber == null) return;
    _currentPage = pageNumber;
    _saveDebounce?.cancel();
    _saveDebounce = Timer(const Duration(seconds: 2), _saveProgress);
    if (mounted) setState(() {});
  }

  void _previousPage() {
    if (_currentPage > 1) {
      _controller.goToPage(pageNumber: _currentPage - 1);
    }
  }

  void _nextPage() {
    if (_totalPages == 0 || _currentPage < _totalPages) {
      _controller.goToPage(pageNumber: _currentPage + 1);
    }
  }

  Future<void> _saveProgress() async {
    if (_totalPages <= 0) return;
    final percent = (_currentPage / _totalPages).clamp(0.0, 1.0);
    try {
      await ref.read(apiServiceProvider).updateProgress(
            widget.bookId.toString(),
            format: widget.format.toUpperCase(),
            percent: percent,
            locator: _currentPage.toString(),
          );
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Scaffold(
        backgroundColor: IronshelfColors.background,
        appBar: AppBar(),
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircularProgressIndicator(
                value: _downloadProgress > 0 ? _downloadProgress : null,
              ),
              const SizedBox(height: 16),
              Text(_downloadProgress > 0
                  ? 'Downloading ${(_downloadProgress * 100).round()}%'
                  : 'Loading PDF…'),
            ],
          ),
        ),
      );
    }

    if (_error != null || _bookFile == null) {
      return Scaffold(
        appBar: AppBar(),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(_error ?? 'Failed to open PDF',
                textAlign: TextAlign.center),
          ),
        ),
      );
    }

    final percent = _totalPages > 0 ? _currentPage / _totalPages : 0.0;

    return Scaffold(
      backgroundColor: IronshelfColors.background,
      body: SafeArea(
        child: Stack(
          children: [
            PdfViewer.file(
              _bookFile!.path,
              controller: _controller,
              params: PdfViewerParams(
                onViewerReady: (document, controller) {
                  setState(() => _totalPages = document.pages.length);
                  final restore = _restorePage;
                  if (restore != null &&
                      restore >= 1 &&
                      restore <= document.pages.length) {
                    controller.goToPage(pageNumber: restore);
                  }
                },
                onPageChanged: _onPageChanged,
              ),
            ),
            // Tap zones: left = previous page, right = next, center = toolbar.
            // Edges only, so pinch-zoom/scroll in the middle still work.
            Positioned.fill(
              child: Row(
                children: [
                  SizedBox(
                    width: 64,
                    child: GestureDetector(
                      behavior: HitTestBehavior.translucent,
                      onTap: _previousPage,
                    ),
                  ),
                  Expanded(
                    child: GestureDetector(
                      behavior: HitTestBehavior.translucent,
                      onTap: () =>
                          setState(() => _chromeVisible = !_chromeVisible),
                    ),
                  ),
                  SizedBox(
                    width: 64,
                    child: GestureDetector(
                      behavior: HitTestBehavior.translucent,
                      onTap: _nextPage,
                    ),
                  ),
                ],
              ),
            ),
            if (_chromeVisible) _buildTopBar(),
            if (_chromeVisible) _buildBottomBar(percent),
          ],
        ),
      ),
    );
  }

  Widget _buildTopBar() {
    return Positioned(
      top: 0,
      left: 0,
      right: 0,
      child: Material(
        color: IronshelfColors.surface.withValues(alpha: 0.95),
        child: Row(
          children: [
            IconButton(
              icon: const Icon(Icons.arrow_back),
              onPressed: () {
                _saveProgress();
                Navigator.of(context).maybePop();
              },
            ),
            const Spacer(),
            if (_totalPages > 0)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Text('$_currentPage / $_totalPages'),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildBottomBar(double percent) {
    return Positioned(
      bottom: 0,
      left: 0,
      right: 0,
      child: Material(
        color: IronshelfColors.surface.withValues(alpha: 0.95),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            children: [
              Expanded(
                child: LinearProgressIndicator(
                  value: percent.clamp(0.0, 1.0),
                  backgroundColor: IronshelfColors.surfaceVariant,
                ),
              ),
              const SizedBox(width: 12),
              Text('${(percent * 100).round()}%'),
            ],
          ),
        ),
      ),
    );
  }
}
