import tensorflow as tf
from tensorflow.keras import layers, models

def build_deep_eeg_model(input_shape=(5760, 2)):
    """
    Hybrid CNN + BiLSTM for complex EEG temporal analysis.
    Designed for NeuroGuard 45-second window inference.
    """
    model = models.Sequential([
        layers.Input(shape=input_shape),
        layers.Conv1D(filters=32, kernel_size=16, activation='relu', padding='same'),
        layers.BatchNormalization(),
        layers.MaxPooling1D(pool_size=4),
        layers.Conv1D(filters=64, kernel_size=8, activation='relu', padding='same'),
        layers.BatchNormalization(),
        layers.MaxPooling1D(pool_size=4),
        layers.Bidirectional(layers.LSTM(64)),
        layers.Dropout(0.3),
        layers.Dense(32, activation='relu'),
        layers.Dense(1, activation='sigmoid')
    ])
    model.compile(optimizer='adam', loss='binary_crossentropy', metrics=['accuracy'])
    return model

if __name__ == "__main__":
    deep_model = build_deep_eeg_model()
    deep_model.summary()
