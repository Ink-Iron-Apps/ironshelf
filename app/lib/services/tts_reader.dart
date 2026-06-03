import 'package:epubx/epubx.dart' as epubx;
import 'package:flutter/foundation.dart';
import 'package:flutter_tts/flutter_tts.dart';

/// One readable chapter: its title, the spine href (for syncing the visual
/// reader), and the plain text to speak.
class TtsChapter {
  final String title;
  final String href;
  final String text;
  const TtsChapter({required this.title, required this.href, required this.text});
}

/// Parse a downloaded EPUB into ordered chapters of plain text for TTS.
Future<List<TtsChapter>> parseEpubChapters(List<int> bytes) async {
  final book = await epubx.EpubReader.readBook(bytes);
  final chapters = <TtsChapter>[];

  void walk(List<epubx.EpubChapter>? list) {
    if (list == null) return;
    for (final chapter in list) {
      final text = _stripHtml(chapter.HtmlContent ?? '');
      if (text.trim().isNotEmpty) {
        chapters.add(TtsChapter(
          title: chapter.Title ?? '',
          href: chapter.ContentFileName ?? '',
          text: text,
        ));
      }
      walk(chapter.SubChapters);
    }
  }

  walk(book.Chapters);
  return chapters;
}

String _stripHtml(String html) {
  var text = html
      .replaceAll(RegExp(r'<(script|style)[^>]*>.*?</\1>', dotAll: true, caseSensitive: false), ' ')
      .replaceAll(RegExp(r'<[^>]+>'), ' ');
  // Decode the few entities that matter for spoken text.
  text = text
      .replaceAll('&nbsp;', ' ')
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&#39;', "'")
      .replaceAll('&quot;', '"')
      .replaceAll('&rsquo;', "'")
      .replaceAll('&lsquo;', "'")
      .replaceAll('&ldquo;', '"')
      .replaceAll('&rdquo;', '"')
      .replaceAll('&mdash;', '—')
      .replaceAll('&ndash;', '–');
  return text.replaceAll(RegExp(r'\s+'), ' ').trim();
}

/// Drives device TTS over a book's chapters. Speaks sentence-by-sentence so it
/// can pause/resume, and advances chapter-by-chapter — notifying a callback so
/// the visual reader (and saved progress) can follow along.
class TtsReader extends ChangeNotifier {
  final FlutterTts _tts = FlutterTts();

  List<TtsChapter> _chapters = const [];
  int _chapterIndex = 0;
  List<String> _chunks = const [];
  int _chunkIndex = 0;
  int _runToken = 0; // invalidates an in-flight loop when state changes

  bool isPlaying = false;
  bool isReady = false;
  double rate = 0.5; // flutter_tts: 0.0–1.0 (0.5 ≈ natural)

  /// Called when playback moves to a new chapter (so the UI can navigate there).
  void Function(TtsChapter chapter, int index)? onChapterChanged;

  int get chapterIndex => _chapterIndex;
  int get chapterCount => _chapters.length;
  String get currentChapterTitle =>
      _chapters.isEmpty ? '' : _chapters[_chapterIndex].title;

  Future<void> load(List<int> epubBytes) async {
    _chapters = await parseEpubChapters(epubBytes);
    await _tts.awaitSpeakCompletion(true);
    await _tts.setSpeechRate(rate);
    isReady = _chapters.isNotEmpty;
    notifyListeners();
  }

  List<String> _splitSentences(String text) {
    // Split after sentence punctuation; keep chunks a sane length for TTS.
    final rough = text.split(RegExp(r'(?<=[.!?])\s+'));
    final chunks = <String>[];
    for (final sentence in rough) {
      final trimmed = sentence.trim();
      if (trimmed.isEmpty) continue;
      if (trimmed.length <= 300) {
        chunks.add(trimmed);
      } else {
        // Very long "sentence" — break on commas/length so TTS stays responsive.
        for (var i = 0; i < trimmed.length; i += 300) {
          chunks.add(trimmed.substring(i, (i + 300).clamp(0, trimmed.length)));
        }
      }
    }
    return chunks;
  }

  void _loadChapter(int index) {
    _chapterIndex = index.clamp(0, _chapters.length - 1);
    _chunks = _splitSentences(_chapters[_chapterIndex].text);
    _chunkIndex = 0;
  }

  /// Start (or restart) playback at [fromChapter].
  Future<void> start(int fromChapter) async {
    if (_chapters.isEmpty) return;
    _loadChapter(fromChapter);
    onChapterChanged?.call(_chapters[_chapterIndex], _chapterIndex);
    isPlaying = true;
    notifyListeners();
    _run(++_runToken);
  }

  Future<void> _run(int token) async {
    while (isPlaying && token == _runToken && _chapterIndex < _chapters.length) {
      if (_chunkIndex >= _chunks.length) {
        // Chapter finished — advance.
        if (_chapterIndex + 1 >= _chapters.length) {
          break; // end of book
        }
        _loadChapter(_chapterIndex + 1);
        onChapterChanged?.call(_chapters[_chapterIndex], _chapterIndex);
        notifyListeners();
        continue;
      }
      final chunk = _chunks[_chunkIndex];
      await _tts.speak(chunk);
      if (!isPlaying || token != _runToken) return;
      _chunkIndex++;
    }
    // Reached the end.
    if (token == _runToken) {
      isPlaying = false;
      notifyListeners();
    }
  }

  Future<void> pause() async {
    isPlaying = false;
    _runToken++; // stop the current loop
    await _tts.stop();
    notifyListeners();
  }

  Future<void> resume() async {
    if (isPlaying || _chapters.isEmpty) return;
    isPlaying = true;
    notifyListeners();
    _run(++_runToken);
  }

  Future<void> stop() async {
    isPlaying = false;
    _runToken++;
    _chunkIndex = 0;
    await _tts.stop();
    notifyListeners();
  }

  Future<void> setRate(double value) async {
    rate = value.clamp(0.1, 1.0);
    await _tts.setSpeechRate(rate);
    notifyListeners();
  }

  /// Jump to a chapter (e.g. when the user navigates the book) without losing
  /// play state.
  Future<void> jumpToChapter(int index) async {
    final wasPlaying = isPlaying;
    _runToken++;
    await _tts.stop();
    _loadChapter(index);
    if (wasPlaying) {
      isPlaying = true;
      notifyListeners();
      _run(++_runToken);
    } else {
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _runToken++;
    _tts.stop();
    super.dispose();
  }
}
