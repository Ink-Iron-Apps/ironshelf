/// Library model matching server API response.
class Library {
  final String id;
  final String name;
  final String libraryType;
  final String sourceKind;

  const Library({
    required this.id,
    required this.name,
    required this.libraryType,
    required this.sourceKind,
  });

  factory Library.fromJson(Map<String, dynamic> json) {
    return Library(
      id: json['id']?.toString() ?? '',
      name: json['name'] as String? ?? '',
      libraryType: json['library_type'] as String? ?? 'book',
      sourceKind: json['source_kind'] as String? ?? 'unknown',
    );
  }
}
