#ifndef NATIVE_TIMER_BRIDGE_H
#define NATIVE_TIMER_BRIDGE_H

#include <stdbool.h>
#import <Foundation/Foundation.h>

// C bridge functions for Swift timer widget
bool create_native_timer_widget(void);
bool close_native_timer_widget(void);

// C bridge functions for microphone permission dialog
bool show_microphone_permission_dialog(void);
bool check_microphone_permission(void);

// TauriEmitAll function for events
void TauriEmitAll(NSString* event, NSString* payload);

// TauriInvoke type for plugin methods
@interface TauriInvoke : NSObject
- (void)resolve;
- (void)reject:(NSString*)error;
@end

#endif // NATIVE_TIMER_BRIDGE_H