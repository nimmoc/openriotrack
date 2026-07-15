#include <stdio.h>
#include <string.h>

#include "rioi.h"

int main (void) {
  rios_t rio;
  int result;

  memset (&rio, 0, sizeof (rio));
  result = open_rio (&rio, 0, 0, 0);
  if (result != URIO_SUCCESS) {
    fprintf (stderr, "open_rio failed: %d\n", result);
    return 1;
  }

  result = abort_transfer_rio (&rio);
  close_rio (&rio);
  if (result != URIO_SUCCESS) {
    fprintf (stderr, "abort_transfer_rio failed: %d\n", result);
    return 1;
  }

  puts ("Pending transfer aborted");
  return 0;
}
