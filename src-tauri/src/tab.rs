

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tuning {
    Standard,
    DropD,
}

impl Tuning {
    pub fn pitches(self) -> [u8; 6] {
        match self {
            Self::Standard => [40, 45, 50, 55, 59, 64],
            Self::DropD => [38, 45, 50, 55, 59, 64],
        }
    }
}
