import UIKit
import Social
import UniformTypeIdentifiers

/// Share Extension entry point.
/// Allows sharing text, images, files, and URLs from other apps into Vostok conversations.
/// The extension presents a conversation picker and sends the shared content via the API.
class ShareViewController: SLComposeServiceViewController {

    override func isContentValid() -> Bool {
        // Content is valid if there's text or attachments
        return true
    }

    override func didSelectPost() {
        // Extract shared items and send to the selected conversation
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
            extensionContext?.completeRequest(returningItems: nil)
            return
        }

        for item in items {
            guard let attachments = item.attachments else { continue }
            for attachment in attachments {
                processAttachment(attachment)
            }
        }

        // Complete the extension
        extensionContext?.completeRequest(returningItems: nil)
    }

    override func configurationItems() -> [Any]! {
        // TODO: Add conversation picker as a configuration item
        // This will show a "Chat" row that opens a conversation selector
        return []
    }

    private func processAttachment(_ attachment: NSItemProvider) {
        if attachment.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            attachment.loadItem(forTypeIdentifier: UTType.plainText.identifier) { item, _ in
                if let text = item as? String {
                    self.shareText(text)
                }
            }
        } else if attachment.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            attachment.loadItem(forTypeIdentifier: UTType.image.identifier) { item, _ in
                if let url = item as? URL {
                    self.shareFile(url)
                } else if let image = item as? UIImage {
                    self.shareImage(image)
                }
            }
        } else if attachment.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            attachment.loadItem(forTypeIdentifier: UTType.url.identifier) { item, _ in
                if let url = item as? URL {
                    self.shareText(url.absoluteString)
                }
            }
        } else if attachment.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
            attachment.loadItem(forTypeIdentifier: UTType.fileURL.identifier) { item, _ in
                if let url = item as? URL {
                    self.shareFile(url)
                }
            }
        }
    }

    private func shareText(_ text: String) {
        // TODO: Send text message to selected chat via API
        // Requires shared app group keychain access for auth token
    }

    private func shareImage(_ image: UIImage) {
        // TODO: Upload image and send as attachment
    }

    private func shareFile(_ url: URL) {
        // TODO: Upload file and send as attachment
    }
}
