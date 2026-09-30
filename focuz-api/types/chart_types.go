package types

type ChartType struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

type PeriodType struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

var ChartTypes = []ChartType{
	{ID: 1, Name: "lineChart"},
	{ID: 2, Name: "barChart"},
}

var PeriodTypes = []PeriodType{
	{ID: 1, Name: "day"},
	{ID: 2, Name: "week"},
	{ID: 3, Name: "month"},
	{ID: 4, Name: "year"},
}

func GetChartTypeByID(id int) *ChartType {
	for _, t := range ChartTypes {
		if t.ID == id {
			return &t
		}
	}
	return nil
}

func GetChartTypeByName(name string) *ChartType {
	for _, t := range ChartTypes {
		if t.Name == name {
			return &t
		}
	}
	return nil
}

func GetPeriodTypeByID(id int) *PeriodType {
	for _, t := range PeriodTypes {
		if t.ID == id {
			return &t
		}
	}
	return nil
}

func GetPeriodTypeByName(name string) *PeriodType {
	for _, t := range PeriodTypes {
		if t.Name == name {
			return &t
		}
	}
	return nil
}
