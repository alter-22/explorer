use arrow_array::{ArrayRef, RecordBatch};
use parquet::{arrow::arrow_writer::ArrowWriter, file::properties::WriterProperties};
use std::{fs::File, sync::Arc};

pub struct EpochFeeMakerRegistryCollection {
    version: Vec<u64>,
    timestamp: Vec<u64>,
    change_index: Vec<u64>,

    epoch_fees_made: Vec<u64>,
}

impl EpochFeeMakerRegistryCollection {
    pub fn new() -> EpochFeeMakerRegistryCollection {
        EpochFeeMakerRegistryCollection {
            version: Vec::new(),
            timestamp: Vec::new(),
            change_index: Vec::new(),
            epoch_fees_made: Vec::new(),
        }
    }

    pub fn push(&mut self, version: u64, timestamp: u64, change_index: u64, epoch_fees_made: u64) {
        self.version.push(version);
        self.timestamp.push(timestamp);
        self.change_index.push(change_index);
        self.epoch_fees_made.push(epoch_fees_made);
    }

    pub fn to_parquet(&self, path: String) {
        if self.version.is_empty() {
            return;
        }

        let version = arrow_array::UInt64Array::from(self.version.clone());
        let timestamp = arrow_array::UInt64Array::from(self.timestamp.clone());
        let change_index = arrow_array::UInt64Array::from(self.change_index.clone());
        let epoch_fees_made = arrow_array::UInt64Array::from(self.epoch_fees_made.clone());

        let batch = RecordBatch::try_from_iter(vec![
            ("version", Arc::new(version) as ArrayRef),
            ("timestamp", Arc::new(timestamp) as ArrayRef),
            ("change_index", Arc::new(change_index) as ArrayRef),
            ("epoch_fees_made", Arc::new(epoch_fees_made) as ArrayRef),
        ])
        .unwrap();

        let parquet_file = File::create(path).unwrap();
        let props = WriterProperties::builder().build();

        let mut writer = ArrowWriter::try_new(parquet_file, batch.schema(), Some(props)).unwrap();
        writer.write(&batch).expect("Writing batch");
        writer.close().unwrap();
    }
}
