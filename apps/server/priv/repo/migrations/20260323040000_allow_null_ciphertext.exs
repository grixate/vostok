defmodule VostokServer.Repo.Migrations.AllowNullCiphertext do
  use Ecto.Migration

  def change do
    alter table(:media_uploads) do
      modify :ciphertext, :binary, null: true
    end
  end
end
