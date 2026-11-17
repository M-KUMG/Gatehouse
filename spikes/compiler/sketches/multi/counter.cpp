#include "counter.h"
static int value = 0;
void counterStep() { value += 3; }
int counterValue() { return value; }
