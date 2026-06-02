import 'dart:async';
import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:photo_view/photo_view.dart';
import 'package:photo_view/photo_view_gallery.dart';

import '../../providers/server_provider.dart';
import '../../theme.dart';

/// Comic reader for CBZ (ZIP) archives. CBR (RAR) cannot be unpacked in-app —
/// same limitation as the web reader — so those show a clear message.
class CbzReaderScreen extends ConsumerStatefulWidget {
  final int bookId;
  final String format;

  const CbzReaderScreen({
    super.key,
    required this.bookId,
    required this.format,
  });

  @override
  ConsumerState<CbzReaderScreen> createState() => _CbzReaderScreenState();
}

class _CbzReaderScreenState extends ConsumerState<CbzReaderScreen> {
  bool _loading = true;
  String? _error;
  bool _isRar = false;
  double _downloadProgress = 0;

  late final PageController _pageController = PageController();
  List<ArchiveFile> _pages = const [];
  int _currentPage = 0;
  bool _chromeVisible = true;

  Timer? _saveDebounce;

  static const _imageExtensions = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'};

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  @override
  void dispose() {
    _saveDebounce?.cancel();
    _pageController.dispose();
    super.dispose();
  }

  Future<void> _bootstrap() async {
    final normalized = widget.format.toLowerCase();
    if (normalized == 'cbr' || normalized == 'cb7') {
      setState(() {
        _isRar = true;
        _loading = false;
      });
      return;
    }

    try {
      final api = ref.read(apiServiceProvider);

      int restorePage = 0;
      try {
        final progressList = await api.getProgress(widget.bookId.toString());
        final match = progressList.where(
          (p) => p.format.toLowerCase() == widget.format.toLowerCase(),
        );
        if (match.isNotEmpty) {
          restorePage = (int.tryParse(match.first.locator ?? '') ?? 1) - 1;
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

      final bytes = await file.readAsBytes();
      final Archive archive;
      try {
        archive = ZipDecoder().decodeBytes(bytes);
      } catch (_) {
        if (!mounted) return;
        setState(() {
          _isRar = true;
          _loading = false;
        });
        return;
      }

      final imageEntries = archive.files
          .where((f) =>
              f.isFile &&
              _isImage(f.name) &&
              !f.name.split('/').last.startsWith('.') &&
              !f.name.startsWith('__MACOSX'))
          .toList()
        ..sort((a, b) => _naturalCompare(a.name, b.name));

      if (!mounted) return;
      if (imageEntries.isEmpty) {
        setState(() {
          _error = 'No images found in this comic archive.';
          _loading = false;
        });
        return;
      }

      _currentPage = restorePage.clamp(0, imageEntries.length - 1);
      setState(() {
        _pages = imageEntries;
        _loading = false;
      });
      if (_currentPage > 0) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (_pageController.hasClients) _pageController.jumpToPage(_currentPage);
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Failed to open comic: $e';
        _loading = false;
      });
    }
  }

  bool _isImage(String name) {
    final lower = name.toLowerCase();
    return _imageExtensions.any(lower.endsWith);
  }

  /// Natural sort so page2 < page10.
  int _naturalCompare(String a, String b) {
    final regex = RegExp(r'\d+|\D+');
    final aParts = regex.allMatches(a).map((m) => m.group(0)!).toList();
    final bParts = regex.allMatches(b).map((m) => m.group(0)!).toList();
    for (var i = 0; i < aParts.length && i < bParts.length; i++) {
      final ap = aParts[i];
      final bp = bParts[i];
      final an = int.tryParse(ap);
      final bn = int.tryParse(bp);
      final int cmp;
      if (an != null && bn != null) {
        cmp = an.compareTo(bn);
      } else {
        cmp = ap.compareTo(bp);
      }
      if (cmp != 0) return cmp;
    }
    return aParts.length.compareTo(bParts.length);
  }

  void _onPageChanged(int index) {
    _currentPage = index;
    _saveDebounce?.cancel();
    _saveDebounce = Timer(const Duration(seconds: 2), _saveProgress);
    if (mounted) setState(() {});
  }

  Future<void> _saveProgress() async {
    if (_pages.isEmpty) return;
    final percent = ((_currentPage + 1) / _pages.length).clamp(0.0, 1.0);
    try {
      await ref.read(apiServiceProvider).updateProgress(
            widget.bookId.toString(),
            format: widget.format.toUpperCase(),
            percent: percent,
            locator: (_currentPage + 1).toString(),
          );
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(backgroundColor: IronshelfColors.background),
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
                  : 'Loading comic…'),
            ],
          ),
        ),
      );
    }

    if (_isRar) {
      return Scaffold(
        appBar: AppBar(),
        body: const Center(
          child: Padding(
            padding: EdgeInsets.all(24),
            child: Text(
              'This comic is a RAR archive (CBR), which cannot be opened in the '
              'app. Convert it to CBZ to read it here.',
              textAlign: TextAlign.center,
            ),
          ),
        ),
      );
    }

    if (_error != null) {
      return Scaffold(
        appBar: AppBar(),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(_error!, textAlign: TextAlign.center),
          ),
        ),
      );
    }

    final percent = _pages.isEmpty ? 0.0 : (_currentPage + 1) / _pages.length;

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          PhotoViewGallery.builder(
            pageController: _pageController,
            itemCount: _pages.length,
            onPageChanged: _onPageChanged,
            backgroundDecoration: const BoxDecoration(color: Colors.black),
            builder: (context, index) {
              final data =
                  Uint8List.fromList(_pages[index].content as List<int>);
              return PhotoViewGalleryPageOptions(
                imageProvider: MemoryImage(data),
                minScale: PhotoViewComputedScale.contained,
                maxScale: PhotoViewComputedScale.covered * 3,
              );
            },
            loadingBuilder: (context, event) =>
                const Center(child: CircularProgressIndicator()),
          ),
          // Tap zones: left/right to page, center to toggle chrome.
          Positioned.fill(
            child: Row(
              children: [
                Expanded(child: GestureDetector(onTap: _previousPage)),
                Expanded(
                  child: GestureDetector(
                    onTap: () =>
                        setState(() => _chromeVisible = !_chromeVisible),
                  ),
                ),
                Expanded(child: GestureDetector(onTap: _nextPage)),
              ],
            ),
          ),
          if (_chromeVisible)
            SafeArea(
              child: Align(
                alignment: Alignment.topLeft,
                child: Material(
                  color: Colors.transparent,
                  child: IconButton(
                    icon: const Icon(Icons.arrow_back, color: Colors.white),
                    onPressed: () {
                      _saveProgress();
                      Navigator.of(context).maybePop();
                    },
                  ),
                ),
              ),
            ),
          if (_chromeVisible)
            Positioned(
              bottom: 0,
              left: 0,
              right: 0,
              child: SafeArea(
                child: Container(
                  color: Colors.black54,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: Row(
                    children: [
                      Expanded(
                        child: LinearProgressIndicator(
                          value: percent.clamp(0.0, 1.0),
                          backgroundColor: Colors.white24,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Text('${_currentPage + 1} / ${_pages.length}',
                          style: const TextStyle(color: Colors.white)),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  void _previousPage() {
    if (_currentPage > 0) {
      _pageController.previousPage(
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
      );
    }
  }

  void _nextPage() {
    if (_currentPage < _pages.length - 1) {
      _pageController.nextPage(
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
      );
    }
  }
}
