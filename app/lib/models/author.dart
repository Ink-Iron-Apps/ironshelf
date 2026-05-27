/// Author model.
class Author {
  final int id;
  final String name;
  final String sortName;
  final int bookCount;
  final int seriesCount;

  const Author({
    required this.id,
    required this.name,
    required this.sortName,
    required this.bookCount,
    required this.seriesCount,
  });

  factory Author.fromJson(Map<String, dynamic> json) {
    return Author(
      id: (json['id'] as num).toInt(),
      name: json['name'] as String? ?? '',
      sortName: json['sort_name'] as String? ?? '',
      bookCount: (json['book_count'] as num?)?.toInt() ?? 0,
      seriesCount: (json['series_count'] as num?)?.toInt() ?? 0,
    );
  }
}
