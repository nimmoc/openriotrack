#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "rioi.h"

static void print_hex (const char *label, const unsigned char *value, size_t length) {
  size_t index;

  printf ("%s=", label);
  for (index = 0 ; index < length ; index++)
    printf ("%02x", value[index]);
  putchar ('\n');
}

int main (int argc, char **argv) {
  rio_file_t file;
  rios_t rio;
  FILE *output;
  long memory_id;
  long file_index;
  int result;

  if (argc != 3 && argc != 4) {
    fprintf (stderr, "usage: dump_device_header <memory-id> <file-index> [output-file]\n");
    return 2;
  }

  memory_id = strtol (argv[1], NULL, 10);
  file_index = strtol (argv[2], NULL, 10);
  if (memory_id < 0 || memory_id >= MAX_MEM_UNITS || file_index < 0 || file_index > UINT16_MAX)
    return 2;

  result = open_rio (&rio, 0, 0, 0);
  if (result != URIO_SUCCESS) {
    fprintf (stderr, "open failed: %s\n", strerror (-result));
    return 1;
  }

  result = get_file_info_rio (&rio, &file, (u_int8_t) memory_id, (u_int16_t) file_index);
  if (result == URIO_SUCCESS) {
    printf ("device_type=%d file_no=%u bits=%08x type=%08x size=%u\n",
            return_type_rio (&rio), file.file_no, file.bits, file.type, file.size);
    print_hex ("name", (const unsigned char *) file.name, sizeof (file.name));
    print_hex ("title", (const unsigned char *) file.title, sizeof (file.title));
    print_hex ("artist", (const unsigned char *) file.artist, sizeof (file.artist));
    print_hex ("album", (const unsigned char *) file.album, sizeof (file.album));
    print_hex ("info0", file.info0, sizeof (file.info0));
    print_hex ("info1", file.info1, sizeof (file.info1));

    if (argc == 4) {
      output = fopen (argv[3], "wb");
      if (output == NULL || fwrite (&file, 1, sizeof (file), output) != sizeof (file)) {
        if (output != NULL)
          fclose (output);
        close_rio (&rio);
        return 1;
      }
      fclose (output);
    }
  } else {
    fprintf (stderr, "read failed: %s\n", strerror (-result));
  }

  close_rio (&rio);
  return (result == URIO_SUCCESS) ? 0 : 1;
}
