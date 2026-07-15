#include <assert.h>
#include <stdio.h>
#include <string.h>

#include "rioi.h"

int main (void) {
  rio_file_t file;
  rio_file_t rendered;
  u_int8_t pixels[RIO800_TITLE_BITMAP_HEIGHT][RIO800_TITLE_BITMAP_WIDTH];
  const u_int8_t *raw = (const u_int8_t *)&file;
  const u_int8_t *rendered_raw = (const u_int8_t *)&rendered;
  int bitmap_pixels = 0;
  int x, y;

  memset (&file, 0, sizeof (file));
  memset (pixels, 0, sizeof (pixels));
  file.type = TYPE_MP3;
  file.bits = 0x10000b11;

  pixels[0][0] = 1;
  pixels[RIO800_TITLE_BITMAP_HEIGHT - 1][RIO800_TITLE_BITMAP_WIDTH - 1] = 1;
  rio_pack_rio800_title_bitmap (&file, pixels);

  assert (raw[RIO800_TITLE_BITMAP_OFFSET] == 0x00);
  assert (raw[RIO800_TITLE_BITMAP_OFFSET + 1] == 0x24);
  assert (raw[RIO800_TITLE_BITMAP_OFFSET + (RIO800_TITLE_BITMAP_WIDTH - 1) * 2] == 0x01);
  assert (raw[RIO800_TITLE_BITMAP_OFFSET + (RIO800_TITLE_BITMAP_WIDTH - 1) * 2 + 1] == 0x20);

  for (x = 0 ; x < RIO800_TITLE_BITMAP_WIDTH ; x++)
    assert ((raw[RIO800_TITLE_BITMAP_OFFSET + x * 2 + 1] & 0x20) != 0);

  rio_prepare_rio800_header (&file);

  assert (file.bits == 0x10400b11);

  memset (&rendered, 0, sizeof (rendered));
  rendered.type = TYPE_MP3;
  strncpy (rendered.title, "中文测试", sizeof (rendered.title) - 1);
  strncpy (rendered.artist, "宋冬野", sizeof (rendered.artist) - 1);
  strncpy (rendered.album, "安和桥北", sizeof (rendered.album) - 1);
  rio_prepare_rio800_header (&rendered);

  assert (rendered_raw[0x34] > 0);
  assert (rendered_raw[0x35] == 0);
  assert (rendered_raw[0x36] == 0x0c);
  assert (rendered_raw[0x37] == 0);
  assert (rendered_raw[0x38] == 0);
  assert (rendered_raw[0x39] == 1);
  assert (rendered.artist[0] == '\0');
  assert (rendered.album[0] == '\0');

  for (x = 0 ; x < RIO800_TITLE_BITMAP_WIDTH ; x++) {
    u_int16_t column = (u_int16_t)rendered_raw[RIO800_TITLE_BITMAP_OFFSET + x * 2] |
      ((u_int16_t)rendered_raw[RIO800_TITLE_BITMAP_OFFSET + x * 2 + 1] << 8);
    assert ((column & 0x2000) != 0);
    for (y = 0 ; y < RIO800_TITLE_BITMAP_HEIGHT ; y++)
      if (column & (1u << y))
        bitmap_pixels++;
  }
  assert (bitmap_pixels > 20);
  assert (bitmap_pixels < 250);

  puts ("rio800 header tests passed");
  return 0;
}
