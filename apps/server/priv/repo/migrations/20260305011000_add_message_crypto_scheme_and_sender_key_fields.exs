defmodule VostokServer.Repo.Migrations.AddMessageCryptoSchemeAndSenderKeyFields do
  use Ecto.Migration

  def change do
    alter table(:messages) do
      add :crypto_scheme, :string
      add :sender_key_id, :string
      add :sender_key_epoch, :integer
    end

    create index(:messages, [:chat_id, :crypto_scheme, :inserted_at])
  end
end
