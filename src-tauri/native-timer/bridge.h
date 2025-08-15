#ifndef NATIVE_TIMER_BRIDGE_H
#define NATIVE_TIMER_BRIDGE_H

#include <stdbool.h>

// C bridge functions for Swift timer widget
bool create_native_timer_widget(void);
bool close_native_timer_widget(void);

#endif // NATIVE_TIMER_BRIDGE_H