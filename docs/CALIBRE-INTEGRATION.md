# Calibre Integration

Caveman ultra. `metadata.db` = SQLite, **READ-ONLY**. Open w/ sqlx `?mode=ro` + immutable/WAL care. Never write.

## Locate
Calibre library dir = has `metadata.db` + per-book folders. Config gives path(s). Cover/file paths relative to this dir.

## Core queries

Authors of library:
```sql
SELECT a.id,a.name,a.sort, COUNT(bal.book) AS book_count
FROM authors a JOIN books_authors_link bal ON bal.author=a.id
GROUP BY a.id ORDER BY a.sort;
```
Series by author:
```sql
SELECT DISTINCT s.id,s.name,s.sort
FROM series s
JOIN books_series_link bsl ON bsl.series=s.id
JOIN books_authors_link bal ON bal.book=bsl.book
WHERE bal.author=? ORDER BY s.sort;
```
Books in series (ordered):
```sql
SELECT b.id,b.title,b.sort,b.series_index,b.pubdate,b.path,b.has_cover
FROM books b JOIN books_series_link bsl ON bsl.book=b.id
WHERE bsl.series=? ORDER BY b.series_index;
```
Standalone (author, no series):
```sql
SELECT b.id,b.title,b.series_index,b.path FROM books b
JOIN books_authors_link bal ON bal.book=b.id
LEFT JOIN books_series_link bsl ON bsl.book=b.id
WHERE bal.author=? AND bsl.series IS NULL ORDER BY b.sort;
```

## Formats + paths
- formats: `SELECT format,name FROM data WHERE book=?` → file `<lib>/<b.path>/<name>.<lower(format)>`
- cover: `<lib>/<b.path>/cover.jpg` if `has_cover`
- description: `SELECT text FROM comments WHERE book=?`
- tags/langs/identifiers/rating via their link tables

## Custom columns (req — read + use)
Discover:
```sql
SELECT id,label,name,datatype,is_multiple FROM custom_columns;
```
For col `id=N`:
- value table `custom_column_N` (id,value[,book for some])
- link `books_custom_column_N_link` (book,value)
- normal: `SELECT cc.value FROM custom_column_N cc JOIN books_custom_column_N_link l ON l.value=cc.id WHERE l.book=?`
- is_multiple → many rows = list
- datatypes: text, comments, int, float, bool, datetime, rating, enumeration, series, composite(skip/compute)
Expose name as `#name` (Calibre convention). Make sortable + filterable.

## Gotchas
- DB may be locked while Calibre app open → open read-only/immutable, retry.
- Path separators: Calibre stores `/`; on disk join w/ OS sep.
- series_index = float (1, 1.5, 2).
- author multi: book→many authors. "first author" = books.author_sort order / link order.
- Re-read on change: watch metadata.db mtime OR manual rescan endpoint.

## Hybrid w/ folder/embedded
Non-Calibre libs: FolderSource scans dirs, reads epub OPF (dc:creator→author, calibre:series + series_index, dc:title, dc:subject→tags/fandom). Same domain model. AO3 fanfic heuristic = port from existing `/home/riley/stump/organize.py` (fandom from subjects, author from creators, skip noise tags).
