#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <UserNotifications/UserNotifications.h>
#import <dispatch/dispatch.h>
#include <stdbool.h>
#include <string.h>

typedef void (*ZingClick)(const char *, const char *);
static ZingClick zingClick;

@interface DropTitlebarBackground : NSView
@end
@implementation DropTitlebarBackground
- (void)drawRect:(NSRect)dirtyRect {
    [[NSColor colorWithSRGBRed:180.0/255 green:35.0/255 blue:54.0/255 alpha:1] setFill];
    NSRectFill(dirtyRect);
}
// Leave native title dragging, double-click and traffic-light hit testing to AppKit.
- (NSView *)hitTest:(NSPoint)point { return nil; }
@end

int drop_style_titlebar(void *pointer) {
    @try {
        if (![NSThread isMainThread] || !pointer) return 0;
        NSWindow *window = (__bridge NSWindow *)pointer;
        NSView *bar = [window standardWindowButton:NSWindowCloseButton].superview;
        if (!bar) return 0;
        window.titlebarAppearsTransparent = YES;
        // Scope the light native title to the red strip; the WebView keeps its chosen theme.
        bar.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
        DropTitlebarBackground *background = [[DropTitlebarBackground alloc] initWithFrame:bar.bounds];
        background.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        [bar addSubview:background positioned:NSWindowBelow relativeTo:nil];
        return 1;
    } @catch (NSException *exception) { return 0; }
}

@interface ZingArrivalDelegate : NSObject <UNUserNotificationCenterDelegate>
@end
@implementation ZingArrivalDelegate
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
      willPresentNotification:(UNNotification *)notification
        withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completion {
    completion(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList);
}
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
didReceiveNotificationResponse:(UNNotificationResponse *)response
        withCompletionHandler:(void (^)(void))completion {
    if ([response.actionIdentifier isEqualToString:UNNotificationDefaultActionIdentifier]) {
        NSDictionary *info = response.notification.request.content.userInfo;
        id origin = info[@"zingOrigin"];
        id item = info[@"zingItem"];
        if ([origin isKindOfClass:[NSString class]] && [item isKindOfClass:[NSString class]] && zingClick) {
            const char *originBytes = [origin UTF8String];
            const char *itemBytes = [item UTF8String];
            if (originBytes && itemBytes && strlen(originBytes) <= 8192 && strlen(itemBytes) == 32 &&
                strlen(originBytes) == [origin lengthOfBytesUsingEncoding:NSUTF8StringEncoding] &&
                strlen(itemBytes) == [item lengthOfBytesUsingEncoding:NSUTF8StringEncoding]) {
                zingClick(originBytes, itemBytes);
            }
        }
    }
    completion();
}
@end

// The center's delegate is weak; retain it for the resident process's lifetime.
static ZingArrivalDelegate *zingDelegate;
int zing_notifications_init(ZingClick click) {
    @try {
        if (![NSBundle mainBundle].bundleIdentifier) return 0;
        zingClick = click;
        zingDelegate = [ZingArrivalDelegate new];
        [UNUserNotificationCenter currentNotificationCenter].delegate = zingDelegate;
        return 1;
    } @catch (NSException *exception) { return 0; }
}

int zing_notifications_permission(void) {
    @autoreleasepool {
        @try {
            dispatch_semaphore_t done = dispatch_semaphore_create(0);
            __block int result = -1;
            [[UNUserNotificationCenter currentNotificationCenter]
                requestAuthorizationWithOptions:UNAuthorizationOptionAlert
                completionHandler:^(BOOL granted, NSError *error) {
                    result = error ? -1 : (granted ? 1 : 0);
                    dispatch_semaphore_signal(done);
                }];
            if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC))) return -1;
            return result;
        } @catch (NSException *exception) { return -1; }
    }
}

int zing_notifications_post(const char *identifier, const char *origin, const char *item, const char *title, const char *body) {
    @autoreleasepool {
        @try {
            UNMutableNotificationContent *content = [UNMutableNotificationContent new];
            content.title = [NSString stringWithUTF8String:title];
            content.body = [NSString stringWithUTF8String:body];
            content.userInfo = @{@"zingOrigin": [NSString stringWithUTF8String:origin],
                                 @"zingItem": [NSString stringWithUTF8String:item]};
            UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:[NSString stringWithUTF8String:identifier]
                content:content trigger:nil];
            dispatch_semaphore_t done = dispatch_semaphore_create(0);
            __block int accepted = 0;
            [[UNUserNotificationCenter currentNotificationCenter] addNotificationRequest:request
                withCompletionHandler:^(NSError *error) {
                    accepted = error == nil;
                    dispatch_semaphore_signal(done);
                }];
            // Acceptance, not presentation. A late completion after timeout is ambiguous and may replay.
            if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC))) return 0;
            return accepted;
        } @catch (NSException *exception) { return 0; }
    }
}
