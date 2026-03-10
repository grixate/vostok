import SwiftUI

/// Shared-media section shown in both ProfileView and ContactProfileView.
/// When `items` is empty renders a "No media yet" placeholder.
struct ProfileMediaSection: View {
    enum MediaTab: CaseIterable, Identifiable {
        case media, files, voice
        var id: Self { self }
        var label: String {
            switch self {
            case .media:  return "Media"
            case .files:  return "Files"
            case .voice:  return "Voice"
            }
        }
        var icon: String {
            switch self {
            case .media:  return "photo.on.rectangle.angled"
            case .files:  return "doc.fill"
            case .voice:  return "waveform"
            }
        }
    }

    /// Placeholder — will carry UIImage / URL when real media fetching is implemented.
    struct MediaItem: Identifiable {
        let id: String
        let thumbnail: UIImage?
        let mediaKind: String   // "image", "video", "file", "audio"
        let filename: String
    }

    let items: [MediaItem]

    @State private var selectedTab: MediaTab = .media

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header row: "Media" + See All
            HStack {
                Text("Media")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(VostokColors.labelPrimary)
                Spacer()
                if !items.isEmpty {
                    Button("See All") {}
                        .font(.system(size: 15, weight: .regular))
                        .foregroundStyle(VostokColors.accent)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 18)
            .padding(.bottom, 12)

            // Tab selector
            HStack(spacing: 0) {
                ForEach(MediaTab.allCases) { tab in
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            selectedTab = tab
                        }
                    } label: {
                        VStack(spacing: 4) {
                            Image(systemName: tab.icon)
                                .font(.system(size: 15, weight: .medium))
                            Text(tab.label)
                                .font(.system(size: 11, weight: .medium))
                        }
                        .foregroundStyle(selectedTab == tab ? VostokColors.accent : VostokColors.labelSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                    }
                    .buttonStyle(.plain)
                    .background(
                        VStack {
                            Spacer()
                            if selectedTab == tab {
                                Rectangle()
                                    .fill(VostokColors.accent)
                                    .frame(height: 2)
                                    .matchedGeometryEffect(id: "mediaTabIndicator", in: namespace)
                            }
                        }
                    )
                }
            }
            .padding(.horizontal, 16)

            Divider()

            // Content
            Group {
                if items.isEmpty {
                    emptyState
                } else {
                    mediaGrid
                }
            }
            .padding(.bottom, 16)
        }
    }

    @Namespace private var namespace

    // MARK: - Empty state

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: emptyIcon)
                .font(.system(size: 32, weight: .light))
                .foregroundStyle(VostokColors.labelSecondary.opacity(0.5))
            Text(emptyLabel)
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle(VostokColors.labelSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 36)
    }

    private var emptyIcon: String {
        switch selectedTab {
        case .media:  return "photo.on.rectangle.angled"
        case .files:  return "doc"
        case .voice:  return "waveform"
        }
    }

    private var emptyLabel: String {
        switch selectedTab {
        case .media:  return "No shared photos or videos"
        case .files:  return "No shared files"
        case .voice:  return "No shared voice messages"
        }
    }

    // MARK: - Grid

    private var filteredItems: [MediaItem] {
        items.filter { item in
            switch selectedTab {
            case .media:  return item.mediaKind == "image" || item.mediaKind == "video"
            case .files:  return item.mediaKind == "file"
            case .voice:  return item.mediaKind == "audio"
            }
        }
    }

    private static let columns = Array(
        repeating: GridItem(.flexible(), spacing: 2),
        count: 3
    )

    private var mediaGrid: some View {
        LazyVGrid(columns: Self.columns, spacing: 2) {
            ForEach(filteredItems) { item in
                mediaTile(item)
            }
        }
        .padding(.horizontal, 2)
        .padding(.top, 2)
    }

    @ViewBuilder
    private func mediaTile(_ item: MediaItem) -> some View {
        GeometryReader { geo in
            ZStack {
                if let img = item.thumbnail {
                    Image(uiImage: img)
                        .resizable()
                        .scaledToFill()
                        .frame(width: geo.size.width, height: geo.size.width)
                        .clipped()
                } else {
                    Rectangle()
                        .fill(VostokColors.labelSecondary.opacity(0.1))
                        .overlay {
                            Image(systemName: "doc.fill")
                                .foregroundStyle(VostokColors.labelSecondary.opacity(0.4))
                        }
                }
                if item.mediaKind == "video" {
                    VStack {
                        HStack {
                            Spacer()
                            Image(systemName: "play.fill")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(.white)
                                .padding(4)
                                .background(.black.opacity(0.5), in: Circle())
                                .padding(4)
                        }
                        Spacer()
                    }
                }
            }
            .frame(width: geo.size.width, height: geo.size.width)
        }
        .aspectRatio(1, contentMode: .fit)
    }
}
