#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Executes `block` inside @try/@catch. Returns YES if no ObjC exception
/// was thrown. On exception, returns NO and fills `error` with the reason.
BOOL VSTKTryObjC(void (NS_NOESCAPE ^block)(void),
                 NSError * _Nullable __autoreleasing * _Nullable error);

NS_ASSUME_NONNULL_END
