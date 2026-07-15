#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "rioi.h"

static int render_count (void) {
  rio_file_t file;
  const u_int8_t *raw;
  int count = 0;
  int x, y;

  memset (&file, 0, sizeof (file));
  file.type = TYPE_MP3;
  strncpy (file.title, "中文测试", sizeof (file.title) - 1);
  rio_prepare_rio800_header (&file);
  raw = (const u_int8_t *)&file;

  for (x = 0 ; x < RIO800_TITLE_BITMAP_WIDTH ; x++) {
    u_int16_t column = (u_int16_t)raw[RIO800_TITLE_BITMAP_OFFSET + x * 2] |
      ((u_int16_t)raw[RIO800_TITLE_BITMAP_OFFSET + x * 2 + 1] << 8);
    for (y = 0 ; y < RIO800_TITLE_BITMAP_HEIGHT ; y++)
      if (column & (1u << y))
        count++;
  }

  return count;
}

int main (int argc, char **argv) {
  rios_t rio;
  int fill_structures = (argc == 2) ? atoi (argv[1]) : 1;
  int result;

  printf ("Before open pixels: %d\n", render_count ());

  memset (&rio, 0, sizeof (rio));
  result = open_rio (&rio, 0, 0, fill_structures);
  if (result != URIO_SUCCESS) {
    fprintf (stderr, "open_rio failed: %d\n", result);
    return 1;
  }

  printf ("After open pixels: %d\n", render_count ());
  close_rio (&rio);
  return 0;
}
