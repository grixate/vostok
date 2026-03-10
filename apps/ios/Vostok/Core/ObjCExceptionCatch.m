#import "ObjCExceptionCatch.h"

BOOL VSTKTryObjC(void (NS_NOESCAPE ^block)(void),
                 NSError * _Nullable __autoreleasing * _Nullable error) {
    @try {
        block();
        return YES;
    } @catch (NSException *exception) {
        if (error) {
            NSString *reason = exception.reason ?: exception.name;
            *error = [NSError errorWithDomain:@"VSTKObjCException"
                                         code:-1
                                     userInfo:@{NSLocalizedDescriptionKey: reason}];
        }
        return NO;
    }
}
