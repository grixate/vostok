defmodule VostokServer.Repo.Migrations.AddCiphertextSha256ToMediaUploads do
  use Ecto.Migration

  def change do
    alter table(:media_uploads) do
      add :ciphertext_sha256, :string
    end
  end
end
