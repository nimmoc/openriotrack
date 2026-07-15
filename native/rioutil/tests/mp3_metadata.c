#include <stdio.h>
#include <string.h>

#include "rioi.h"

int main (int argc, char **argv) {
  rio_file_t file;
  int result;

  if (argc != 2)
    return 2;

  memset (&file, 0, sizeof (file));
  result = get_id3_info (argv[1], &file);
  if (result < 0)
    return 1;

  printf ("title=%s\nartist=%s\nalbum=%s\n", file.title, file.artist, file.album);
  return 0;
}
